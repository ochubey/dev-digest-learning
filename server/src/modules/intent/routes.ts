import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { Intent } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { IntentService } from './service.js';
import { IntentRepository } from './repository.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { ReviewRepository } from '../reviews/repository.js';
import { intentFilesFromDiff } from './diff-files.js';
import { resolveFeatureModel } from '../settings/feature-models.js';

const IntentResponse = z.object({
  pr_id: z.string(),
  summary: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: z.number(),
  sources: z.array(z.object({ label: z.string(), status: z.enum(['fetched', 'unavailable', 'error']) })),
  missing_context: z.array(z.string()),
  stale: z.boolean(),
  derived_from_head_sha: z.string().nullable(),
  model: z.string().nullable(),
  cost_usd: z.number().nullable(),
  derived_at: z.string().nullable(),
});

export type IntentResponse = z.infer<typeof IntentResponse>;

const DeriveFailure = z.object({ error: z.string(), retry_after: z.number() });
const DeriveBody = z.object({ force: z.boolean().optional() }).optional();
const DeriveQuery = z.object({ force: z.enum(['true', 'false', '1', '0']).optional() });

/** Per-PR derive rate limit: one derive attempt per window. */
export const DERIVE_RATE_LIMIT_MS = 30_000;

type IntentRow = NonNullable<Awaited<ReturnType<IntentRepository['getIntent']>>>;

function toResponse(
  pr: { id: string; headSha: string },
  row: IntentRow & { summary: string },
): IntentResponse {
  return {
    pr_id: pr.id,
    summary: row.summary,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    sources: row.sources,
    missing_context: row.missingContext || [],
    stale: row.derivedFromHeadSha !== pr.headSha,
    derived_from_head_sha: row.derivedFromHeadSha || null,
    model: row.model || null,
    // `??`, not `||`: a legitimate cost of 0 must stay 0 (null = never stored)
    cost_usd: row.costUsd ?? null,
    derived_at: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

/**
 * Intent Layer routes:
 *   GET /pulls/:id/intent         → read cached intent (404 if not derived)
 *   POST /pulls/:id/intent/derive → trigger intent derivation (immediate)
 *     - rate limited: 1 attempt per 30s per PR -> 429 {error, retry_after}
 *       (in-memory, per process: resets on restart and is not shared between instances;
 *       failed attempts count too, so a failing LLM cannot be hammered)
 *     - 502 {error, retry_after} when derivation fails
 *     - optional `force` (body `{force:true}` or `?force=true`) bypasses the cache; the
 *       rate limit still applies
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const lastDerive = new Map<string, number>();

  // GET /pulls/:id/intent
  app.get(
    '/pulls/:id/intent',
    { schema: { params: IdParams, response: { 200: IntentResponse } } },
    async (req): Promise<IntentResponse> => {
      const { workspaceId } = await getContext(container, req);

      // Fetch the PR
      const [pr] = await container.db
        .select()
        .from(t.pullRequests)
        .where(eq(t.pullRequests.id, req.params.id));

      if (!pr) throw new NotFoundError('PR not found');

      // Check workspace access
      if (pr.workspaceId !== workspaceId) {
        throw new AppError('forbidden', 'Forbidden', 403);
      }

      // Fetch the intent
      const repo = new IntentRepository(container.db);
      const row = await repo.getIntent(pr.id);

      if (!row || !row.summary) {
        throw new NotFoundError('Intent not derived for this PR');
      }

      return toResponse(pr, { ...row, summary: row.summary });
    },
  );

  // POST /pulls/:id/intent/derive
  app.post(
    '/pulls/:id/intent/derive',
    {
      schema: {
        params: IdParams,
        body: DeriveBody,
        querystring: DeriveQuery,
        response: { 200: IntentResponse, 429: DeriveFailure, 502: DeriveFailure },
      },
    },
    async (req, reply): Promise<IntentResponse> => {
      const { workspaceId } = await getContext(container, req);

      // Fetch the PR
      const [pr] = await container.db
        .select()
        .from(t.pullRequests)
        .where(eq(t.pullRequests.id, req.params.id));

      if (!pr) throw new NotFoundError('PR not found');

      // Check workspace access
      if (pr.workspaceId !== workspaceId) {
        throw new AppError('forbidden', 'Forbidden', 403);
      }

      // Rate limit: one attempt per window per PR (checked before any GitHub/LLM work)
      const startedAt = Date.now();
      for (const [id, ts] of lastDerive) {
        if (startedAt - ts >= DERIVE_RATE_LIMIT_MS) lastDerive.delete(id);
      }
      const retryAfter = () =>
        Math.max(1, Math.ceil(((lastDerive.get(pr.id) ?? startedAt) + DERIVE_RATE_LIMIT_MS - Date.now()) / 1000));
      if (lastDerive.has(pr.id)) {
        const wait = retryAfter();
        return reply
          .status(429)
          .header('Retry-After', String(wait))
          .send({ error: 'Intent was derived for this PR recently; try again later', retry_after: wait });
      }
      lastDerive.set(pr.id, startedAt);

      const force = req.body?.force === true || ['true', '1'].includes(req.query.force ?? '');

      // Get repo info
      const [repo] = await container.db
        .select()
        .from(t.repos)
        .where(eq(t.repos.id, pr.repoId));

      if (!repo) throw new NotFoundError('Repo not found');

      // Files + hunk headers: the same diff the review run loads (loadDiff), NOT the pr_files
      // table (lazily filled on PR-detail open, so often empty). Fail-open: no diff -> no files.
      let prFiles: ReturnType<typeof intentFilesFromDiff> = [];
      try {
        prFiles = intentFilesFromDiff(
          await loadDiff(container, new ReviewRepository(container.db), workspaceId, pr, repo),
        );
      } catch (err) {
        req.log.warn({ prId: pr.id, err: (err as Error).message, step: 'intent.derive' }, 'intent: diff load failed; deriving without files');
      }

      // Derive intent
      const github = await container.github();
      const service = new IntentService(container, github);

      // Resolve review_intent feature model (defaults to openrouter flash model)
      const featureModel = await resolveFeatureModel(container, workspaceId, 'review_intent');

      // Fallback: the workspace's first enabled agent's model (the "main review model")
      const [agent] = await container.db
        .select()
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)))
        .limit(1);

      const result = await service.deriveIntentDetailed(
        pr,
        { owner: repo.owner, name: repo.name },
        prFiles,
        featureModel.provider,
        featureModel.model,
        { force, fallback: agent ? { provider: agent.provider, model: agent.model } : undefined },
      );

      for (const w of result.meta?.warnings ?? []) {
        req.log.warn({ prId: pr.id, step: 'intent.derive' }, w);
      }

      if (result.status === 'failed') {
        req.log.warn({ prId: pr.id, err: result.error, step: 'intent.derive' }, 'intent derive failed');
        return reply
          .status(502)
          .send({ error: 'Failed to derive intent from LLM', retry_after: retryAfter() });
      }

      // Fetch and return the persisted intent
      const intentRepo = new IntentRepository(container.db);
      const row = await intentRepo.getIntent(pr.id);

      if (!row || !row.summary) {
        return reply.status(502).send({ error: 'Failed to persist intent', retry_after: retryAfter() });
      }

      return toResponse(pr, { ...row, summary: row.summary });
    },
  );
}
