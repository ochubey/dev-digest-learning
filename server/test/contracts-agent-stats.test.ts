import { describe, it, expect } from 'vitest';
import { AgentStats } from '@devdigest/shared';

const stats = (over: Record<string, unknown> = {}) => ({
  agent_id: 'a1',
  agent_name: 'Security',
  runs: 3,
  findings_total: 4,
  accepted: 2,
  dismissed: 1,
  pending: 1,
  accept_rate: 2 / 3,
  dismiss_rate: 1 / 3,
  avg_findings_per_run: 4 / 3,
  total_cost_usd: 0.03,
  avg_cost_usd: 0.015,
  avg_latency_ms: 1200,
  findings_by_severity: { CRITICAL: 1, WARNING: 2, SUGGESTION: 1 },
  trend: [{ label: '2026-10-01', value: 3 }],
  period_from: '2026-09-18T00:00:00.000Z',
  period_to: '2026-10-18T00:00:00.000Z',
  runs_excluded: 1,
  runs_with_cost: 2,
  runs_without_cost: 1,
  decisions: 3,
  low_sample: true,
  last_run_at: '2026-10-01T10:00:00.000Z',
  last_run_at_all_time: '2026-10-01T10:00:00.000Z',
  cost_basis: 'estimate',
  ...over,
});

describe('AgentStats contract (SPEC-06 additive fields)', () => {
  it('parses a full object', () => {
    expect(AgentStats.parse(stats())).toMatchObject({ decisions: 3, cost_basis: 'estimate', low_sample: true });
  });

  it('accepts null last-run timestamps', () => {
    const p = AgentStats.parse(stats({ last_run_at: null, last_run_at_all_time: null }));
    expect(p.last_run_at).toBeNull();
    expect(p.last_run_at_all_time).toBeNull();
  });

  it('cost_basis only accepts "estimate"', () => {
    expect(AgentStats.safeParse(stats({ cost_basis: 'billed' })).success).toBe(false);
    expect(AgentStats.safeParse(stats({ cost_basis: undefined })).success).toBe(false);
  });

  it.each(['period_from', 'period_to', 'runs_excluded', 'runs_with_cost', 'runs_without_cost', 'decisions', 'low_sample', 'last_run_at', 'last_run_at_all_time'])(
    'requires %s',
    (k) => {
      const s = stats() as Record<string, unknown>;
      delete s[k];
      expect(AgentStats.safeParse(s).success).toBe(false);
    },
  );

  it('keeps the existing fields', () => {
    const keys = Object.keys(AgentStats.shape);
    for (const k of ['agent_id', 'agent_name', 'runs', 'findings_total', 'accepted', 'dismissed', 'pending', 'accept_rate', 'dismiss_rate', 'avg_findings_per_run', 'total_cost_usd', 'avg_cost_usd', 'avg_latency_ms', 'findings_by_severity', 'trend']) {
      expect(keys).toContain(k);
    }
  });
});
