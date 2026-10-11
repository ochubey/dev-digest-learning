import type { EvalRunCounts, EvalRunMetrics, EvalSuiteRunStatus } from '@devdigest/shared';
import { scoreRun, type ScorableResult } from './scoring.js';

export interface FinalizableResult extends ScorableResult {
  duration_ms: number | null;
  cost_usd: number | null;
}

export interface FinalizedRun {
  status: Exclude<EvalSuiteRunStatus, 'running'>;
  metrics: EvalRunMetrics;
  counts: EvalRunCounts;
  durationMs: number;
  /** Null when any case's cost is unknown. */
  costUsd: number | null;
}

/** AC-38: final status, metrics, total duration and total cost of a finished run. */
export function finalizeRun(results: ReadonlyArray<FinalizableResult>): FinalizedRun {
  const { metrics, counts } = scoreRun(results);
  const errored = results.filter((r) => r.status === 'error').length;
  const status = errored === 0 ? 'completed' : errored === results.length ? 'failed' : 'completed_with_errors';
  const durationMs = results.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0);
  const costUsd = results.some((r) => r.cost_usd == null)
    ? null
    : results.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
  return { status, metrics, counts, durationMs, costUsd };
}
