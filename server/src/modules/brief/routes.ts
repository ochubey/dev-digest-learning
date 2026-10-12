import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PerKeyCooldown } from '../../platform/cooldown.js';
import { BriefService } from './service.js';
import { BriefResponseSchema } from './schema.js';
import { BRIEF_RATE_LIMIT_MS } from './constants.js';

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
  // One cooldown for the life of the process (not per request).
  const service = new BriefService(container, { cooldown: new PerKeyCooldown(BRIEF_RATE_LIMIT_MS) });

  // GET /pulls/:id/brief
  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: BriefResponseSchema } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.id, req.log);
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
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const out = await service.generateForPr(workspaceId, req.params.id, req.log);
      if (out.kind === 'rate_limited') {
        return reply
          .status(429)
          .header('Retry-After', String(out.retryAfter))
          .send({
            error: 'A brief was requested for this PR recently; try again later',
            retry_after: out.retryAfter,
          });
      }
      if (out.kind === 'failed') {
        return reply.status(502).send({ error: out.error, retry_after: out.retryAfter });
      }
      return out.brief;
    },
  );
}
