import { describe, it, expect } from 'vitest';
import type { AgentStats } from '@devdigest/shared';
import {
  decisionOf, isRatedScope, rate, buildAgentStats, buildTrend, buildTotals, mostActive,
  costByAgent, normalizeModel, costByModel,
  type RunAggRow, type FindingAggRow,
} from '../src/modules/agent-performance/rules.js';
import { resolvePeriod } from '../src/modules/agent-performance/period.js';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const period3d = resolvePeriod({ from: '2026-10-01T00:00:00Z', to: '2026-10-04T00:00:00Z' }, NOW);
const t = (s: string) => new Date(`2026-10-01T${s}Z`);

const runRow = (o: Partial<RunAggRow> = {}): RunAggRow => ({
  agentId: 'a1', counted: 0, excluded: 0, withCost: 0, totalCost: null, durationSum: null, durationCount: 0, lastRanAt: null, ...o,
});
const fnd = (decision: FindingAggRow['decision'], n: number, severity = 'WARNING'): FindingAggRow => ({ agentId: 'a1', decision, severity, n });

const stats = (o: { run?: RunAggRow; findings?: FindingAggRow[]; days?: { day: string; n: number }[]; allTime?: Date | null; name?: string; id?: string } = {}): AgentStats =>
  buildAgentStats({
    agent: { id: o.id ?? 'a1', name: o.name ?? 'Agent' },
    period: period3d,
    run: o.run,
    findings: o.findings ?? [],
    days: o.days ?? [],
    lastRunAllTime: o.allTime ?? null,
  });

describe('decisionOf (mirrors the evals rule)', () => {
  it('four combos plus the tie', () => {
    expect(decisionOf({ acceptedAt: t('10:00:00'), dismissedAt: null })).toBe('accepted');
    expect(decisionOf({ acceptedAt: null, dismissedAt: t('10:00:00') })).toBe('dismissed');
    expect(decisionOf({ acceptedAt: null, dismissedAt: null })).toBe('pending');
    expect(decisionOf({ acceptedAt: t('10:00:00'), dismissedAt: t('11:00:00') })).toBe('dismissed');
    expect(decisionOf({ acceptedAt: t('12:00:00'), dismissedAt: t('11:00:00') })).toBe('accepted');
    expect(decisionOf({ acceptedAt: t('10:00:00'), dismissedAt: t('10:00:00') })).toBe('accepted');
  });
});

describe('isRatedScope', () => {
  it('in and null are rated; out and signal are not', () => {
    expect(isRatedScope('in')).toBe(true);
    expect(isRatedScope(null)).toBe(true);
    expect(isRatedScope('out')).toBe(false);
    expect(isRatedScope('signal')).toBe(false);
  });
});

describe('rate', () => {
  it('null at zero denominator', () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(3, 4)).toBe(0.75);
  });
});

describe('buildAgentStats', () => {
  it('3 accepted / 1 dismissed / 6 pending: 0.75, 0.25, decisions 4, low sample', () => {
    const s = stats({ run: runRow({ counted: 2 }), findings: [fnd('accepted', 3), fnd('dismissed', 1), fnd('pending', 6)] });
    expect(s).toMatchObject({ accepted: 3, dismissed: 1, pending: 6, decisions: 4, accept_rate: 0.75, dismiss_rate: 0.25, findings_total: 10, low_sample: true });
    expect(s.avg_findings_per_run).toBe(5);
  });

  it('0 decisions gives null rates (only pending, or no findings)', () => {
    expect(stats({ run: runRow({ counted: 1 }), findings: [fnd('pending', 2)] })).toMatchObject({ accept_rate: null, dismiss_rate: null, decisions: 0, low_sample: true });
    expect(stats({ run: runRow({ counted: 1 }) })).toMatchObject({ accept_rate: null, dismiss_rate: null, findings_total: 0 });
  });

  it('low_sample at 0, 4 and 5 decisions', () => {
    const at = (n: number) => stats({ run: runRow({ counted: 1 }), findings: [fnd('accepted', n)] }).low_sample;
    expect(at(0)).toBe(true);
    expect(at(4)).toBe(true);
    expect(at(5)).toBe(false);
  });

  it('findings by severity and totals over rated findings', () => {
    const s = stats({
      run: runRow({ counted: 4 }),
      findings: [fnd('accepted', 1, 'CRITICAL'), fnd('pending', 2, 'WARNING'), fnd('dismissed', 1, 'SUGGESTION'), fnd('pending', 1, 'CRITICAL')],
    });
    expect(s.findings_total).toBe(5);
    expect(s.findings_by_severity).toEqual({ CRITICAL: 2, WARNING: 2, SUGGESTION: 1 });
    expect(s.avg_findings_per_run).toBe(1.25);
  });

  it('avg_findings_per_run is null when runs = 0', () => {
    expect(stats().avg_findings_per_run).toBeNull();
  });

  it('cost sums non-null costs; avg cost over runs with cost; a run without cost never lowers it', () => {
    const s = stats({ run: runRow({ counted: 3, withCost: 2, totalCost: 0.04 }) });
    expect(s.total_cost_usd).toBeCloseTo(0.04, 12);
    expect(s.avg_cost_usd).toBeCloseTo(0.02, 12);
    expect(s).toMatchObject({ runs_with_cost: 2, runs_without_cost: 1 });
  });

  it('all-null costs give null total and average; a real zero cost is a cost', () => {
    expect(stats({ run: runRow({ counted: 2 }) })).toMatchObject({ total_cost_usd: null, avg_cost_usd: null, runs_with_cost: 0, runs_without_cost: 2 });
    expect(stats({ run: runRow({ counted: 1, withCost: 1, totalCost: 0 }) })).toMatchObject({ total_cost_usd: 0, avg_cost_usd: 0, runs_without_cost: 0 });
  });

  it('avg duration ignores null durations and is rounded', () => {
    const s = stats({ run: runRow({ counted: 3, durationSum: 2001, durationCount: 2 }) });
    expect(s.avg_latency_ms).toBe(1001); // 1000.5 -> 1001
    expect(stats({ run: runRow({ counted: 2 }) }).avg_latency_ms).toBeNull();
  });

  it('an agent with no run rows has zeros, nulls and the all-time last run only', () => {
    const s = stats({ allTime: new Date('2026-08-01T08:00:00.000Z') });
    expect(s).toMatchObject({ runs: 0, runs_excluded: 0, last_run_at: null, last_run_at_all_time: '2026-08-01T08:00:00.000Z', cost_basis: 'estimate' });
    expect(s.period_from).toBe('2026-10-01T00:00:00.000Z');
    expect(s.period_to).toBe('2026-10-04T00:00:00.000Z');
  });

  it('excluded runs are only counted', () => {
    const s = stats({ run: runRow({ counted: 0, excluded: 3 }) });
    expect(s).toMatchObject({ runs: 0, runs_excluded: 3, total_cost_usd: null, avg_latency_ms: null });
  });

  it('last_run_at is an ISO instant', () => {
    expect(stats({ run: runRow({ counted: 1, lastRanAt: new Date('2026-10-02T10:00:00.000Z') }) }).last_run_at).toBe('2026-10-02T10:00:00.000Z');
  });
});

describe('buildTrend', () => {
  it('one point per UTC day, zero days included, oldest first', () => {
    expect(buildTrend(period3d, [{ day: '2026-10-01', n: 2 }, { day: '2026-10-03', n: 1 }])).toEqual([
      { label: '2026-10-01', value: 2 },
      { label: '2026-10-02', value: 0 },
      { label: '2026-10-03', value: 1 },
    ]);
  });

  it('a period ending mid-day touches that day; start mid-day too', () => {
    const p = resolvePeriod({ from: '2026-10-01T12:00:00Z', to: '2026-10-02T06:00:00Z' }, NOW);
    expect(buildTrend(p, []).map((x) => x.label)).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('offset-based instants are bucketed in UTC', () => {
    const p = resolvePeriod({ from: '2026-10-01T01:00:00+02:00', to: '2026-10-02T01:00:00+02:00' }, NOW);
    expect(buildTrend(p, []).map((x) => x.label)).toEqual(['2026-09-30', '2026-10-01']);
  });
});

describe('buildTotals', () => {
  const a = (name: string, o: Partial<AgentStats>): AgentStats => ({ ...stats({ name, id: name }), ...o });

  it('totals equal per-agent sums; pooled rate differs from the mean of rates', () => {
    const agents = [
      a('A', { runs: 3, runs_excluded: 1, runs_with_cost: 2, runs_without_cost: 1, accepted: 1, dismissed: 0, decisions: 1, accept_rate: 1, total_cost_usd: 0.01 }),
      a('B', { runs: 5, runs_excluded: 0, runs_with_cost: 5, runs_without_cost: 0, accepted: 5, dismissed: 5, decisions: 10, accept_rate: 0.5, total_cost_usd: 0.02 }),
    ];
    const t = buildTotals(agents, 2);
    expect(t).toMatchObject({ runs: 8, runs_excluded: 1, deleted_agent_runs: 2, runs_with_cost: 7, runs_without_cost: 1, accepted: 6, dismissed: 5, decisions: 11, low_sample: false });
    expect(t.total_cost_usd).toBeCloseTo(0.03, 12);
    expect(t.accept_rate).toBeCloseTo(6 / 11, 12);
    expect(t.accept_rate).not.toBeCloseTo((1 + 0.5) / 2, 3);
  });

  it('null total cost when every agent total is null; null rate and low_sample at 0 decisions', () => {
    const t = buildTotals([a('A', {}), a('B', {})], 0);
    expect(t).toMatchObject({ total_cost_usd: null, accept_rate: null, decisions: 0, low_sample: true, runs: 0 });
    expect(buildTotals([], 0).total_cost_usd).toBeNull();
  });

  it('a zero total counts as a cost', () => {
    expect(buildTotals([a('A', { total_cost_usd: 0 })], 0).total_cost_usd).toBe(0);
  });

  it('low_sample flips at pooled decisions 5', () => {
    expect(buildTotals([a('A', { decisions: 4, accepted: 4 })], 0).low_sample).toBe(true);
    expect(buildTotals([a('A', { decisions: 5, accepted: 5 })], 0).low_sample).toBe(false);
  });
});

describe('mostActive', () => {
  const a = (id: string, name: string, runs: number) => ({ ...stats({ id, name }), runs });
  it('most runs wins', () => {
    expect(mostActive([a('1', 'x', 2), a('2', 'y', 5)])).toEqual({ agent_id: '2', agent_name: 'y', runs: 5 });
  });
  it('ties by name ascending case-insensitively ("beta" vs "Alpha"), then id', () => {
    expect(mostActive([a('1', 'beta', 3), a('2', 'Alpha', 3)])!.agent_name).toBe('Alpha');
    expect(mostActive([a('9', 'same', 3), a('2', 'Same', 3)])!.agent_id).toBe('2');
  });
  it('null when no runs', () => {
    expect(mostActive([a('1', 'x', 0)])).toBeNull();
    expect(mostActive([])).toBeNull();
  });
});

describe('costByAgent', () => {
  const a = (name: string, cost: number | null, withCost: number) => ({ ...stats({ id: name, name }), total_cost_usd: cost, runs_with_cost: withCost });
  it('lists agents with cost, cost descending then name, sum equals the total', () => {
    const agents = [a('b', 0.01, 1), a('a', 0.01, 1), a('c', 0.05, 2), a('none', null, 0)];
    const out = costByAgent(agents);
    expect(out.map((x) => x.agent_name)).toEqual(['c', 'a', 'b']);
    expect(out.reduce((s, x) => s + x.cost_usd, 0)).toBeCloseTo(buildTotals(agents, 0).total_cost_usd!, 9);
    expect(out[0]).toEqual({ agent_id: 'c', agent_name: 'c', cost_usd: 0.05, runs_with_cost: 2 });
  });
  it('a zero cost with a cost run is listed', () => {
    expect(costByAgent([a('z', 0, 1)])).toHaveLength(1);
  });
});

describe('normalizeModel / costByModel', () => {
  it('trims, maps null/blank to unknown, keeps case', () => {
    expect(normalizeModel(' a ')).toBe('a');
    expect(normalizeModel('')).toBe('unknown');
    expect(normalizeModel('  \t')).toBe('unknown');
    expect(normalizeModel(null)).toBe('unknown');
    expect(normalizeModel('A')).toBe('A');
  });

  it('groups "a", " a ", "", null, "A" into a, A, unknown and sums to the total', () => {
    const rows = [
      { model: 'a', cost: 0.01, withCost: 1 },
      { model: ' a ', cost: 0.02, withCost: 1 },
      { model: '', cost: 0.04, withCost: 2 },
      { model: null, cost: 0.08, withCost: 1 },
      { model: 'A', cost: 0.16, withCost: 1 },
    ];
    const out = costByModel(rows);
    expect(out.map((x) => x.model)).toEqual(['A', 'unknown', 'a']);
    expect(out.find((x) => x.model === 'a')).toMatchObject({ runs_with_cost: 2 });
    expect(out.find((x) => x.model === 'unknown')).toMatchObject({ runs_with_cost: 3 });
    expect(out.reduce((s, x) => s + x.cost_usd, 0)).toBeCloseTo(0.31, 9);
  });

  it('skips groups without any cost; equal costs ordered by model', () => {
    const out = costByModel([
      { model: 'nocost', cost: null, withCost: 0 },
      { model: 'b', cost: 0.1, withCost: 1 },
      { model: 'a', cost: 0.1, withCost: 1 },
    ]);
    expect(out.map((x) => x.model)).toEqual(['a', 'b']);
  });
});

describe('totals are sums of the parts (AC-24, randomized, seeded)', () => {
  /** mulberry32: small deterministic PRNG so a failure is reproducible from the case index. */
  const prng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const MODELS = ['m/a', ' m/a ', 'm/b', '', '  ', 'x/c'];

  for (let c = 0; c < 200; c++) {
    it(`case ${c}`, () => {
      const rnd = prng(1000 + c);
      const int = (max: number) => Math.floor(rnd() * (max + 1));
      const nAgents = int(6);
      const agents: AgentStats[] = [];
      const modelRows: { model: string | null; cost: number | null; withCost: number }[] = [];
      for (let i = 0; i < nAgents; i++) {
        const counted = int(8);
        const withCost = counted === 0 ? 0 : int(counted);
        const total = withCost === 0 ? null : rnd() * 5 * (rnd() < 0.2 ? 1e-6 : 1);
        const findings: FindingAggRow[] = (['accepted', 'dismissed', 'pending'] as const)
          .map((d) => ({ ...fnd(d, int(7)), agentId: `a${i}` }));
        agents.push(
          stats({
            id: `a${i}`,
            name: `Agent ${i}`,
            run: runRow({ agentId: `a${i}`, counted, excluded: int(3), withCost, totalCost: total, durationSum: counted * 1000, durationCount: counted }),
            findings,
          }),
        );
        // Split this agent's cost over 1..3 model buckets; the parts add up to its total.
        if (total !== null) {
          const k = 1 + int(2);
          let left = total;
          let runsLeft = withCost;
          for (let j = 0; j < k; j++) {
            const last = j === k - 1 || runsLeft <= 1;
            const part = last ? left : left * rnd();
            const runsPart = last ? runsLeft : Math.max(1, int(runsLeft - 1));
            modelRows.push({ model: MODELS[int(MODELS.length - 1)]!, cost: part, withCost: runsPart });
            left -= part;
            runsLeft -= runsPart;
            if (last) break;
          }
        }
      }
      const deleted = int(4);
      const totals = buildTotals(agents, deleted);
      const sum = (f: (a: AgentStats) => number) => agents.reduce((s, a) => s + f(a), 0);

      expect(totals.runs).toBe(sum((a) => a.runs));
      expect(totals.runs_excluded).toBe(sum((a) => a.runs_excluded));
      expect(totals.runs_with_cost).toBe(sum((a) => a.runs_with_cost));
      expect(totals.runs_without_cost).toBe(sum((a) => a.runs_without_cost));
      expect(totals.accepted).toBe(sum((a) => a.accepted));
      expect(totals.dismissed).toBe(sum((a) => a.dismissed));
      expect(totals.decisions).toBe(totals.accepted + totals.dismissed);
      expect(totals.deleted_agent_runs).toBe(deleted);

      const perAgentCost = agents.reduce((s, a) => s + (a.total_cost_usd ?? 0), 0);
      const byAgent = costByAgent(agents);
      const byModel = costByModel(modelRows);
      if (totals.total_cost_usd === null) {
        expect(agents.every((a) => a.total_cost_usd === null)).toBe(true);
        expect(byAgent).toEqual([]);
        expect(byModel).toEqual([]);
      } else {
        expect(Math.abs(totals.total_cost_usd - perAgentCost)).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(byAgent.reduce((s, x) => s + x.cost_usd, 0) - totals.total_cost_usd)).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(byModel.reduce((s, x) => s + x.cost_usd, 0) - totals.total_cost_usd)).toBeLessThanOrEqual(1e-9);
      }
    });
  }
});
