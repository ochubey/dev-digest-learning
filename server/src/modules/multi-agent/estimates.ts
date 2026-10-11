import type { AgentRunEstimate } from '@devdigest/shared';

export interface EstimateRow {
  duration_ms: number | null;
  cost_usd: number | null;
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;

/** Estimate from an agent's latest done runs (rows are already limited by the caller). */
export function estimateFromRuns(agentId: string, rows: EstimateRow[]): AgentRunEstimate {
  const durations = rows.flatMap((r) => (r.duration_ms == null ? [] : [r.duration_ms]));
  const costs = rows.flatMap((r) => (r.cost_usd == null ? [] : [r.cost_usd]));
  const avgDuration = mean(durations);
  return {
    agent_id: agentId,
    sample_size: rows.length,
    avg_duration_ms: avgDuration === null ? null : Math.round(avgDuration),
    avg_cost_usd: mean(costs),
  };
}
