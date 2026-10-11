import { describe, it, expect } from 'vitest';
import { estimateFromRuns } from '../src/modules/multi-agent/estimates.js';
import { ESTIMATE_SAMPLE } from '../src/modules/multi-agent/constants.js';

describe('estimateFromRuns', () => {
  it('12 done + 2 failed + one null-cost: sample 10, averages over the latest 10 done, failed ignored, cost mean of non-null', () => {
    // Simulates the repository contract: only done runs, newest first, limited to ESTIMATE_SAMPLE.
    const all = [
      ...Array.from({ length: 12 }, (_, i) => ({
        status: 'done',
        duration_ms: 1000 * (i + 1), // newest first: 1000..12000
        cost_usd: i === 3 ? null : 0.1 * (i + 1),
      })),
      { status: 'failed', duration_ms: 999999, cost_usd: 99 },
      { status: 'failed', duration_ms: 999999, cost_usd: 99 },
    ];
    const rows = all.filter((r) => r.status === 'done').slice(0, ESTIMATE_SAMPLE);
    expect(ESTIMATE_SAMPLE).toBe(10);
    const est = estimateFromRuns('ag', rows);
    expect(est.agent_id).toBe('ag');
    expect(est.sample_size).toBe(10);
    expect(est.avg_duration_ms).toBe(5500); // mean of 1000..10000
    const costs = rows.flatMap((r) => (r.cost_usd == null ? [] : [r.cost_usd]));
    expect(costs).toHaveLength(9);
    expect(est.avg_cost_usd).toBeCloseTo(costs.reduce((s, c) => s + c, 0) / 9, 10);
  });

  it('no runs: sample 0, both null', () => {
    expect(estimateFromRuns('ag', [])).toEqual({
      agent_id: 'ag',
      sample_size: 0,
      avg_duration_ms: null,
      avg_cost_usd: null,
    });
  });
});
