import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AgentStats } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { PeriodQuery, resolvePeriod } from './period.js';
import { AgentPerformance } from './schemas.js';
import { AgentPerformanceService } from './service.js';

/**
 * agent-performance module (read-only; nothing here writes or calls a model).
 *   GET /agents/:id/stats?from=&to=   → AgentStats of one agent for the period
 *   GET /agent-performance?from=&to=  → AgentPerformance (totals, every agent, cost breakdowns)
 * Both omit `from`/`to` for the 30 days ending now; invalid periods answer 422.
 */
export default async function agentPerformanceRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new AgentPerformanceService(container);

  app.get(
    '/agents/:id/stats',
    { schema: { params: IdParams, querystring: PeriodQuery, response: { 200: AgentStats } } },
    async (req) => {
      const started = Date.now();
      const { workspaceId } = await getContext(container, req);
      const period = resolvePeriod(req.query, new Date());
      const stats = await service.agentStats(workspaceId, req.params.id, period);
      req.log.info(
        {
          endpoint: 'agent-stats',
          from: period.from.toISOString(),
          to: period.to.toISOString(),
          agents: 1,
          runs: stats.runs,
          ms: Date.now() - started,
        },
        'agent performance',
      );
      return stats;
    },
  );

  app.get(
    '/agent-performance',
    { schema: { querystring: PeriodQuery, response: { 200: AgentPerformance } } },
    async (req) => {
      const started = Date.now();
      const { workspaceId } = await getContext(container, req);
      const period = resolvePeriod(req.query, new Date());
      const result = await service.dashboard(workspaceId, period);
      req.log.info(
        {
          endpoint: 'agent-performance',
          from: result.period.from,
          to: result.period.to,
          agents: result.agents.length,
          runs: result.totals.runs,
          ms: Date.now() - started,
        },
        'agent performance',
      );
      return result;
    },
  );
}
