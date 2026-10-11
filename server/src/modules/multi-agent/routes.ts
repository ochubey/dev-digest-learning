import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MultiAgentService } from './service.js';

/**
 * multi-agent module (read-only; launching is POST /pulls/:id/review {agentIds}).
 *   GET /multi-agent-runs/:id   → MultiAgentRun (columns, groups, conflicts)
 *   GET /multi-agent/estimates  → AgentRunEstimate[] for the workspace's agents
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new MultiAgentService(container);

  app.get('/multi-agent-runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getRun(workspaceId, req.params.id);
  });

  app.get('/multi-agent/estimates', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.estimates(workspaceId);
  });
}
