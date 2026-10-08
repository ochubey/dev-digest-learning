import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { PrBrief } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { BriefRepository } from './repository.js';
import { BriefService } from './service.js';
import { logBriefGeneration } from './log-line.js';
import { BRIEF_RATE_LIMIT_MS } from './constants.js';

/** Route response: the stored brief plus the PR id and the computed staleness. */
export const BriefResponseSchema = PrBrief.extend({
  pr_id: z.string(),
  stale: z.boolean(),
});
export type BriefResponse = z.infer<typeof BriefResponseSchema>;

const BriefFailure = z.object({ error: z.string(), retry_after: z.number() });

/**
 * PR Brief routes:
 *   GET  /pulls/:id/brief → the stored brief (DB only: no GitHub, git or model call); 404 if none
 *   POST /pulls/:id/brief → generate (one model call) and store; replaces the stored brief
 *     - rate limited: 1 admitted request per 30s per PR -> 429 {error, retry_after} + Retry-After
 *       (in-memory, per process; every admitted request counts, failures included)
 *     - 502 {error, retry_after} when generation fails (nothing is written)
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const lastAdmitted = new Map<string, number>();
  /** PR ids with a generation currently running (released in a finally block). */
  const inFlight = new Set<string>();

  const secondsLeft = (prId: string, nowMs: number): number =>
    Math.max(1, Math.ceil(((lastAdmitted.get(prId) ?? nowMs) + BRIEF_RATE_LIMIT_MS - nowMs) / 1000));

  /** Synchronous check-and-set (no await in between), so concurrent requests cannot both pass. */
  function admit(prId: string, nowMs: number): { ok: true } | { ok: false; retryAfter: number } {
    for (const [id, ts] of lastAdmitted) {
      if (nowMs - ts >= BRIEF_RATE_LIMIT_MS && !inFlight.has(id)) lastAdmitted.delete(id);
    }
    // A generation can outlive the cooldown: while one is running, no second one is admitted.
    if (inFlight.has(prId) || lastAdmitted.has(prId)) {
      return { ok: false, retryAfter: secondsLeft(prId, nowMs) };
    }
    lastAdmitted.set(prId, nowMs);
    inFlight.add(prId);
    return { ok: true };
  }

  async function loadPull(prId: string, workspaceId: string) {
    const [pr] = await container.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, prId));
    if (!pr) throw new NotFoundError('PR not found');
    if (pr.workspaceId !== workspaceId) throw new AppError('forbidden', 'Forbidden', 403);
    return pr;
  }

  // GET /pulls/:id/brief
  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: BriefResponseSchema } } },
    async (req): Promise<BriefResponse> => {
      const { workspaceId } = await getContext(container, req);
      const pr = await loadPull(req.params.id, workspaceId);

      const json = await new BriefRepository(container.db).getBrief(pr.id);
      if (json === undefined) throw new NotFoundError('Brief not generated for this PR');

      const parsed = PrBrief.safeParse(json);
      if (!parsed.success) {
        req.log.warn({ prId: pr.id, step: 'brief' }, 'brief: stored brief failed to parse; treating as absent');
        throw new NotFoundError('Brief not generated for this PR');
      }
      return {
        ...parsed.data,
        pr_id: pr.id,
        stale: parsed.data.meta.generated_from_head_sha !== pr.headSha,
      };
    },
  );

  // POST /pulls/:id/brief
  app.post(
    '/pulls/:id/brief',
    {
      schema: {
        params: IdParams,
        response: { 200: BriefResponseSchema, 429: BriefFailure, 502: BriefFailure },
      },
    },
    async (req, reply): Promise<BriefResponse> => {
      const { workspaceId } = await getContext(container, req);
      // 404 / 403 come before any limiter admission, GitHub call, model call or write.
      const pr = await loadPull(req.params.id, workspaceId);
      const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
      if (!repo) throw new NotFoundError('Repo not found');

      const startedAt = Date.now();
      const admission = admit(pr.id, startedAt);
      if (!admission.ok) {
        req.log.warn({ prId: pr.id, step: 'brief' }, 'brief: rate limited');
        return reply
          .status(429)
          .header('Retry-After', String(admission.retryAfter))
          .send({
            error: 'A brief was requested for this PR recently; try again later',
            retry_after: admission.retryAfter,
          });
      }

      let result;
      try {
        const service = new BriefService(container);
        result = await service.generate({ workspaceId, pr, repo, log: req.log });
      } catch (err) {
        // Unexpected failure (not a model/provider outcome): still exactly one log line.
        logBriefGeneration(req.log, {
          prId: pr.id,
          outcome: 'provider_error',
          calls: 0,
          truncated: [],
          missing: [],
          error_class: 'Error',
          error_message: 'Unexpected error while generating the brief',
        });
        throw err;
      } finally {
        inFlight.delete(pr.id);
      }
      logBriefGeneration(req.log, result.meta);

      if (result.status === 'failed') {
        return reply
          .status(502)
          .send({ error: result.error, retry_after: secondsLeft(pr.id, Date.now()) });
      }

      // Staleness against the head SHA as it is now (a push may have landed during generation).
      const [current] = await container.db
        .select()
        .from(t.pullRequests)
        .where(eq(t.pullRequests.id, pr.id));
      const currentSha = current?.headSha ?? pr.headSha;
      return {
        ...result.brief,
        pr_id: pr.id,
        stale: result.brief.meta.generated_from_head_sha !== currentSha,
      };
    },
  );
}
