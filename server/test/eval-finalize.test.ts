import { describe, it, expect } from 'vitest';
import type { EvalExpectation } from '@devdigest/shared';
import { finalizeRun } from '../src/modules/evals/finalize.js';

const expectation: EvalExpectation = { kind: 'must_find', file: 'a.ts', start_line: 1, end_line: 2 };
const res = (
  status: 'ok' | 'error',
  over: Partial<{ duration_ms: number | null; cost_usd: number | null }> = {},
) => ({
  status,
  expectation,
  grounded: status === 'ok' ? [{ file: 'a.ts', start_line: 1, end_line: 1 }] : [],
  dropped: [],
  duration_ms: 100 as number | null,
  cost_usd: 0.01 as number | null,
  ...over,
});

describe('finalizeRun', () => {
  it('all ok -> completed; some error -> completed_with_errors; all error -> failed, metrics null; cost null if any case null; durations summed', () => {
    const ok = finalizeRun([res('ok'), res('ok', { duration_ms: 250 })]);
    expect(ok.status).toBe('completed');
    expect(ok.durationMs).toBe(350);
    expect(ok.costUsd).toBeCloseTo(0.02);
    expect(ok.metrics.recall).toBe(1);

    const some = finalizeRun([res('ok'), res('error', { cost_usd: 0 })]);
    expect(some.status).toBe('completed_with_errors');
    expect(some.counts.cases_errored).toBe(1);

    const all = finalizeRun([res('error'), res('error')]);
    expect(all.status).toBe('failed');
    expect(all.metrics).toEqual({ recall: null, precision: null, citation_accuracy: null });

    expect(finalizeRun([res('ok'), res('ok', { cost_usd: null })]).costUsd).toBeNull();
    expect(finalizeRun([res('ok', { duration_ms: null }), res('ok')]).durationMs).toBe(100);
  });
});
