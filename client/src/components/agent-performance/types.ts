import type { AgentStats } from "@devdigest/shared";

/**
 * Client mirror of the `GET /agent-performance` envelope. The server owns the
 * zod schema (`server/src/modules/agent-performance/schemas.ts`, SPEC-06 D-2);
 * the shared fixture `src/test/fixtures/agent-performance.sample.json` pins both.
 */
export interface AgentPerformanceTotals {
  runs: number;
  runs_excluded: number;
  deleted_agent_runs: number;
  total_cost_usd: number | null;
  runs_with_cost: number;
  runs_without_cost: number;
  accepted: number;
  dismissed: number;
  decisions: number;
  accept_rate: number | null;
  low_sample: boolean;
}

export interface MostActive {
  agent_id: string;
  agent_name: string;
  runs: number;
}

export interface CostByAgent {
  agent_id: string;
  agent_name: string;
  cost_usd: number;
  runs_with_cost: number;
}

export interface CostByModel {
  model: string;
  cost_usd: number;
  runs_with_cost: number;
}

export interface AgentPerformance {
  period: { from: string; to: string };
  cost_basis: "estimate";
  totals: AgentPerformanceTotals;
  most_active: MostActive | null;
  agents: AgentStats[];
  cost_by_agent: CostByAgent[];
  cost_by_model: CostByModel[];
}
