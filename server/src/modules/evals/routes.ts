import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EvalCaseDraft,
  EvalCaseView,
  EvalCompare,
  EvalOverview,
  EvalRunPage,
  EvalRunStartInput,
  EvalRunStartResponse,
  EvalSuiteRunDetail,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { EVAL_RUN_RATE_LIMIT } from './constants.js';
import { EvalsService } from './service.js';

const RunsQuery = z.object({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

/**
 * evals module (SPEC-03).
 *   GET    /findings/:id/eval-case-draft   read-only draft of a case from a decided finding
 *   POST   /eval-cases                     create a case (service validation answers 400/409)
 *   GET    /agents/:id/eval-cases          the agent's cases with their last result
 *   DELETE /eval-cases/:id
 *   POST   /agents/:id/eval-runs           202; optional body {model}; runs in the background; rate limited
 *   GET    /agents/:id/eval-runs           paged, newest first
 *   GET    /eval-runs/compare?a=&b=
 *   GET    /eval-runs/:id
 *   GET    /evals/overview
 * The POST /eval-cases body is parsed by the service (not zod) so a bad case is a 400 with
 * reasons rather than the app-wide 422; path and query shapes are zod (422).
 */
export default async function evalsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalsService(container);

  app.get(
    '/findings/:id/eval-case-draft',
    { schema: { params: IdParams, response: { 200: EvalCaseDraft } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.draft(workspaceId, req.params.id);
    },
  );

  app.post('/eval-cases', { schema: { response: { 201: EvalCaseView } } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const created = await service.createCase(workspaceId, req.body);
    return reply.status(201).send(created);
  });

  app.get(
    '/agents/:id/eval-cases',
    { schema: { params: IdParams, response: { 200: z.array(EvalCaseView) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listCases(workspaceId, req.params.id);
    },
  );

  app.delete(
    '/eval-cases/:id',
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.literal(true) }) } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.deleteCase(workspaceId, req.params.id);
    },
  );

  // Each run can fan out to up to 50 model calls: same tight limit as starting a PR review.
  app.post(
    '/agents/:id/eval-runs',
    {
      // Body is optional and parsed in the handler (a ZodError is the app-wide 422): no body, or {}, runs the agent's own model; {model} overrides it for this run only.
      schema: { params: IdParams, response: { 202: EvalRunStartResponse } },
      config: { rateLimit: EVAL_RUN_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const input = EvalRunStartInput.parse(req.body ?? {});
      const started = await service.startRun(workspaceId, req.params.id, req.log, input.model);
      return reply.status(202).send(started);
    },
  );

  app.get(
    '/agents/:id/eval-runs',
    { schema: { params: IdParams, querystring: RunsQuery, response: { 200: EvalRunPage } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listRuns(workspaceId, req.params.id, req.query.cursor ?? null, req.query.limit);
    },
  );

  // Static segment: registered alongside /eval-runs/:id (find-my-way prefers the static route).
  app.get(
    '/eval-runs/compare',
    { schema: { querystring: CompareQuery, response: { 200: EvalCompare } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.compare(workspaceId, req.query.a, req.query.b);
    },
  );

  app.get(
    '/eval-runs/:id',
    { schema: { params: IdParams, response: { 200: EvalSuiteRunDetail } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getRun(workspaceId, req.params.id);
    },
  );

  app.get('/evals/overview', { schema: { response: { 200: EvalOverview } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.overview(workspaceId);
  });
}
