import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { changedFilesForPr } from './files.js';
import { buildBlastRadius, BlastResponseSchema, type BlastResponse } from './build.js';

/**
 * Blast Radius routes:
 *   GET /pulls/:id/blast → changed symbols, their callers, affected endpoints/crons.
 * Reads what repo-intel already computed; no model call, no recompute (the changed-file
 * list comes from the PR diff, see `files.ts`). Never 5xx on a missing index:
 * `getBlastRadius` never throws and reports `degraded` + `reason`.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

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
}
