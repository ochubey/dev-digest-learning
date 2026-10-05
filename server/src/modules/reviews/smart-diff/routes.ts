import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { SmartDiff } from '@devdigest/shared';
import * as t from '../../../db/schema.js';
import { getContext } from '../../_shared/context.js';
import { IdParams } from '../../_shared/schemas.js';
import { AppError, NotFoundError } from '../../../platform/errors.js';
import { buildSmartDiff, latestFindingsPerAgent } from './build.js';

/**
 * Smart Diff routes:
 *   GET /pulls/:id/smart-diff → changed files grouped by role + finding lines.
 * Deterministic: path rules and existing findings only, no model call.
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams, response: { 200: SmartDiff } } },
    async (req): Promise<SmartDiff> => {
      const { workspaceId } = await getContext(container, req);

      const [pr] = await container.db
        .select()
        .from(t.pullRequests)
        .where(eq(t.pullRequests.id, req.params.id));
      if (!pr) throw new NotFoundError('PR not found');
      if (pr.workspaceId !== workspaceId) throw new AppError('forbidden', 'Forbidden', 403);

      const repo = container.reviewRepo;
      const [files, reviews] = await Promise.all([
        repo.getPrFiles(pr.id),
        repo.reviewsForPull(pr.id),
      ]);

      return buildSmartDiff(files, latestFindingsPerAgent(reviews));
    },
  );
}
