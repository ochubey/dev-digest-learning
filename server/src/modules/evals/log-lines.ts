import type { EvalRunMetrics, EvalSuiteRunStatus } from '@devdigest/shared';
import { REASON_MAX } from './constants.js';

/**
 * Run-log text for eval runs (AC-48). Ids, counts, statuses and numbers only: these
 * builders take no diff fragment and no model output.
 */

const num = (n: number | null): string => (n == null ? 'null' : String(n));

export function runStartLine(a: { agent: string; version: number; cases: number; model: string }): string {
  return `eval.run start: agent="${a.agent}" version=${a.version} cases=${a.cases} model=${a.model}`;
}

export function runEndLine(a: {
  status: EvalSuiteRunStatus;
  metrics: EvalRunMetrics;
  durationMs: number;
  cost: number | null;
}): string {
  const m = a.metrics;
  return (
    `eval.run end: status=${a.status} recall=${num(m.recall)} precision=${num(m.precision)} ` +
    `citation_accuracy=${num(m.citation_accuracy)} duration_ms=${a.durationMs} cost_usd=${num(a.cost)}`
  );
}

/** The reason is reduced to its first line and capped; callers pass an already sanitized message. */
export function caseErrorLine(caseId: string, reason: string): string {
  const first = (reason.split('\n')[0] ?? '').trim().slice(0, REASON_MAX);
  return `eval.case error: case=${caseId} reason=${first}`;
}
