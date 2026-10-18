import { z } from 'zod';
import { AgentStats } from '@devdigest/shared';

/**
 * Envelope of `GET /agent-performance` (SPEC-06 D-2). Owned by this module, not
 * the vendored contracts; the client mirrors it in
 * `client/src/components/agent-performance/types.ts`, pinned by a shared fixture.
 * Per-agent entries are the shared `AgentStats`.
 */
export const AgentPerformanceTotals = z
  .object({
    runs: z.number().int(),
    runs_excluded: z.number().int(),
    deleted_agent_runs: z.number().int(),
    total_cost_usd: z.number().nullable(),
    runs_with_cost: z.number().int(),
    runs_without_cost: z.number().int(),
    accepted: z.number().int(),
    dismissed: z.number().int(),
    decisions: z.number().int(),
    accept_rate: z.number().nullable(),
    low_sample: z.boolean(),
  })
  .strict();
export type AgentPerformanceTotals = z.infer<typeof AgentPerformanceTotals>;

export const MostActive = z
  .object({ agent_id: z.string(), agent_name: z.string(), runs: z.number().int() })
  .strict();
export type MostActive = z.infer<typeof MostActive>;

export const CostByAgent = z
  .object({
    agent_id: z.string(),
    agent_name: z.string(),
    cost_usd: z.number(),
    runs_with_cost: z.number().int(),
  })
  .strict();
export type CostByAgent = z.infer<typeof CostByAgent>;

export const CostByModel = z
  .object({ model: z.string(), cost_usd: z.number(), runs_with_cost: z.number().int() })
  .strict();
export type CostByModel = z.infer<typeof CostByModel>;

export const AgentPerformance = z
  .object({
    period: z.object({ from: z.string(), to: z.string() }).strict(),
    cost_basis: z.literal('estimate'),
    totals: AgentPerformanceTotals,
    most_active: MostActive.nullable(),
    agents: z.array(AgentStats),
    cost_by_agent: z.array(CostByAgent),
    cost_by_model: z.array(CostByModel),
  })
  .strict();
export type AgentPerformance = z.infer<typeof AgentPerformance>;
