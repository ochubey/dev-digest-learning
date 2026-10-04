import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { PrHistory } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { changedFilesForPr } from './files.js';
import { buildBlastRadius, BlastResponseSchema, type BlastResponse } from './build.js';
import { buildPrHistory } from './history.js';
import { HISTORY_CACHE_MAX, HISTORY_CACHE_TTL_MS, HISTORY_SCAN_LIMIT } from './constants.js';

/**
 * Blast Radius routes:
 *   GET /pulls/:id/blast   → changed symbols, their callers, affected endpoints/crons.
 *   GET /pulls/:id/history → prior merged PRs touching the same files (GitHub API).
 * Reads what repo-intel already computed; no model call, no recompute (the changed-file
 * list comes from the PR diff, see `files.ts`). Never 5xx on a missing index:
 * `getBlastRadius` never throws and reports `degraded` + `reason`.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const historyCache = new Map<string, { at: number; value: PrHistory }>();

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastResponseSchema } } },
    async (req): Promise<BlastResponse> => {
      const { workspaceId } = await getContext(container, req);

      const [pr] = await container.db
        .select()
        .from(t.pullRequests)
        .where(eq(t.pullRequests.id, req.params.id));
      if (!pr) throw new NotFoundError('PR not found');
      if (pr.workspaceId !== workspaceId) throw new AppError('forbidden', 'Forbidden', 403);

      const files = await changedFilesForPr(container, workspaceId, pr, req.log);
      const result = await container.repoIntel.getBlastRadius(pr.repoId, files);
      // One line per request: shows a prebuilt-index read (degraded=false), not a re-parse.
      req.log.info(
        {
          prId: pr.id,
          step: 'blast',
          files: files.length,
          symbols: result.changedSymbols.length,
          callers: result.callers.length,
          degraded: result.degraded === true,
          reason: result.reason ?? null,
        },
        'blast: read repo-intel index',
      );
      return buildBlastRadius(result);
    },
  );

  /**
   * Prior merged PRs touching the files this PR changes, from the GitHub API (bounded scan,
   * cached per PR + head sha). A scan window, not a full history. "Could not check" (no
   * token, GitHub error, rate limit) is a 502, never an empty list, so the UI can tell it
   * apart from "no recent PR touched these files".
   */
  app.get(
    '/pulls/:id/history',
    { schema: { params: IdParams, response: { 200: PrHistory } } },
    async (req): Promise<PrHistory> => {
      const { workspaceId } = await getContext(container, req);

      const [pr] = await container.db
        .select()
        .from(t.pullRequests)
        .where(eq(t.pullRequests.id, req.params.id));
      if (!pr) throw new NotFoundError('PR not found');
      if (pr.workspaceId !== workspaceId) throw new AppError('forbidden', 'Forbidden', 403);

      const key = `${pr.id}:${pr.headSha}`;
      const hit = historyCache.get(key);
      if (hit && Date.now() - hit.at < HISTORY_CACHE_TTL_MS) return hit.value;

      try {
        const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
        if (!repo) return { history: [] };
        const files = await changedFilesForPr(container, workspaceId, pr, req.log);
        if (files.length === 0) return { history: [] };
        const gh = await container.github();
        const merged = await gh.listMergedPullRequestsWithFiles(
          { owner: repo.owner, name: repo.name },
          { limit: HISTORY_SCAN_LIMIT, excludeNumber: pr.number },
        );
        const value = buildPrHistory(merged, files);
        if (historyCache.size >= HISTORY_CACHE_MAX) {
          historyCache.delete(historyCache.keys().next().value as string);
        }
        historyCache.set(key, { at: Date.now(), value });
        return value;
      } catch (err) {
        req.log.warn({ prId: pr.id, err: (err as Error).message, step: 'history' }, 'blast: prior PRs unavailable');
        throw new AppError('github_unavailable', 'Could not load prior PRs from GitHub', 502);
      }
    },
  );
}
