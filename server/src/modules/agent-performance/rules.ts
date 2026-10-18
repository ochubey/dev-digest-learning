import type { AgentStats, StatPoint } from '@devdigest/shared';
import { COST_BASIS, DAY_MS, LOW_SAMPLE_MIN, UNKNOWN_MODEL } from './constants.js';
import type { Period } from './period.js';
import type { AgentPerformanceTotals, CostByAgent, CostByModel, MostActive } from './schemas.js';

/**
 * Pure aggregation rules (SPEC-06 "Definitions"). The repository does the heavy
 * grouping in SQL; everything here turns those grouped rows into the contract.
 */

/** Per-agent run aggregate over the period: `counted` = done runs, `excluded` = every other status. */
export interface RunAggRow {
  agentId: string;
  counted: number;
  excluded: number;
  withCost: number;
  totalCost: number | null;
  durationSum: number | null;
  durationCount: number;
  lastRanAt: Date | null;
}

/** Rated findings of counted runs, grouped by agent, severity and decision. */
export interface FindingAggRow {
  agentId: string;
  severity: string;
  decision: Decision;
  n: number;
}

export interface DayRow {
  day: string; // YYYY-MM-DD, UTC
  n: number;
}

export interface ModelAggRow {
  model: string | null;
  cost: number | null;
  withCost: number;
}

export type Decision = 'accepted' | 'dismissed' | 'pending';

/**
 * Same precedence as `decisionOf` in the evals module (re-implemented, that one is
 * module-private): the later timestamp wins, a tie is accepted. The repository's SQL
 * CASE mirrors this function; the integration test pins them together.
 */
export function decisionOf(f: { acceptedAt: Date | null; dismissedAt: Date | null }): Decision {
  if (f.acceptedAt && !f.dismissedAt) return 'accepted';
  if (f.dismissedAt && !f.acceptedAt) return 'dismissed';
  if (f.acceptedAt && f.dismissedAt) return f.acceptedAt >= f.dismissedAt ? 'accepted' : 'dismissed';
  return 'pending';
}

/** Legacy findings (null scope) count as in-scope (SPEC-06 D-10). */
export function isRatedScope(scope: string | null): boolean {
  return scope === 'in' || scope === null;
}

/**
 * Money derived in TypeScript goes through here: 9 decimal places drops float noise
 * (2.0100000000000002 -> 2.01) so a single-agent and a grouped computation of the same
 * data print the same number. One rounding path for every cost quantity.
 */
export const roundMoney = (n: number): number => Math.round(n * 1e9) / 1e9;

export const rate = (n: number, d: number): number | null => (d === 0 ? null : n / d);

const SEVERITIES = ['CRITICAL', 'WARNING', 'SUGGESTION'] as const;

export interface AgentStatsInput {
  agent: { id: string; name: string };
  period: Period;
  run: RunAggRow | undefined;
  findings: FindingAggRow[];
  days: DayRow[];
  lastRunAllTime: Date | null;
}

export function buildAgentStats(i: AgentStatsInput): AgentStats {
  const runs = i.run?.counted ?? 0;
  const withCost = i.run?.withCost ?? 0;
  const totalCost = withCost > 0 ? roundMoney(i.run?.totalCost ?? 0) : null;
  const durCount = i.run?.durationCount ?? 0;

  const byDecision = { accepted: 0, dismissed: 0, pending: 0 };
  const bySeverity = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of i.findings) {
    byDecision[f.decision] += f.n;
    if ((SEVERITIES as readonly string[]).includes(f.severity)) bySeverity[f.severity as (typeof SEVERITIES)[number]] += f.n;
  }
  const { accepted, dismissed, pending } = byDecision;
  const decisions = accepted + dismissed;
  const findingsTotal = decisions + pending;

  return {
    agent_id: i.agent.id,
    agent_name: i.agent.name,
    runs,
    findings_total: findingsTotal,
    accepted,
    dismissed,
    pending,
    accept_rate: rate(accepted, decisions),
    dismiss_rate: rate(dismissed, decisions),
    avg_findings_per_run: runs === 0 ? null : findingsTotal / runs,
    total_cost_usd: totalCost,
    avg_cost_usd: totalCost === null ? null : roundMoney(totalCost / withCost),
    avg_latency_ms: durCount === 0 ? null : Math.round((i.run?.durationSum ?? 0) / durCount),
    findings_by_severity: bySeverity,
    trend: buildTrend(i.period, i.days),
    period_from: i.period.from.toISOString(),
    period_to: i.period.to.toISOString(),
    runs_excluded: i.run?.excluded ?? 0,
    runs_with_cost: withCost,
    runs_without_cost: runs - withCost,
    decisions,
    low_sample: decisions < LOW_SAMPLE_MIN,
    last_run_at: i.run?.lastRanAt ? i.run.lastRanAt.toISOString() : null,
    last_run_at_all_time: i.lastRunAllTime ? i.lastRunAllTime.toISOString() : null,
    cost_basis: COST_BASIS,
  };
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** One point per UTC day touched by `[from, to)`, oldest first; days without runs are 0. */
export function buildTrend(period: Period, rows: DayRow[]): StatPoint[] {
  const counts = new Map(rows.map((r) => [r.day, r.n]));
  const startDay = Date.parse(`${utcDay(period.from.getTime())}T00:00:00.000Z`);
  const lastDay = Date.parse(`${utcDay(period.to.getTime() - 1)}T00:00:00.000Z`);
  const out: StatPoint[] = [];
  for (let d = startDay; d <= lastDay; d += DAY_MS) {
    const label = utcDay(d);
    out.push({ label, value: counts.get(label) ?? 0 });
  }
  return out;
}

export function buildTotals(agents: AgentStats[], deletedAgentRuns: number): AgentPerformanceTotals {
  const sum = (f: (a: AgentStats) => number) => agents.reduce((s, a) => s + f(a), 0);
  const costs = agents.flatMap((a) => (a.total_cost_usd === null ? [] : [a.total_cost_usd]));
  const accepted = sum((a) => a.accepted);
  const dismissed = sum((a) => a.dismissed);
  const decisions = accepted + dismissed;
  return {
    runs: sum((a) => a.runs),
    runs_excluded: sum((a) => a.runs_excluded),
    deleted_agent_runs: deletedAgentRuns,
    total_cost_usd: costs.length === 0 ? null : roundMoney(costs.reduce((s, c) => s + c, 0)),
    runs_with_cost: sum((a) => a.runs_with_cost),
    runs_without_cost: sum((a) => a.runs_without_cost),
    accepted,
    dismissed,
    decisions,
    accept_rate: rate(accepted, decisions),
    low_sample: decisions < LOW_SAMPLE_MIN,
  };
}

/** Deterministic ordering: case-insensitive name, then id. */
const byNameThenId = (a: { agent_name: string; agent_id: string }, b: { agent_name: string; agent_id: string }) => {
  const x = a.agent_name.toLowerCase();
  const y = b.agent_name.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a.agent_id < b.agent_id ? -1 : a.agent_id > b.agent_id ? 1 : 0;
};

export function mostActive(agents: AgentStats[]): MostActive | null {
  const ranked = agents.filter((a) => a.runs > 0).sort((a, b) => b.runs - a.runs || byNameThenId(a, b));
  const top = ranked[0];
  return top ? { agent_id: top.agent_id, agent_name: top.agent_name, runs: top.runs } : null;
}

export function costByAgent(agents: AgentStats[]): CostByAgent[] {
  return agents
    .filter((a) => a.runs_with_cost > 0 && a.total_cost_usd !== null)
    .sort((a, b) => b.total_cost_usd! - a.total_cost_usd! || byNameThenId(a, b))
    .map((a) => ({
      agent_id: a.agent_id,
      agent_name: a.agent_name,
      cost_usd: a.total_cost_usd!,
      runs_with_cost: a.runs_with_cost,
    }));
}

/** Trimmed, case-sensitive; null or blank becomes `unknown`. */
export function normalizeModel(model: string | null): string {
  const m = (model ?? '').trim();
  return m === '' ? UNKNOWN_MODEL : m;
}

export function costByModel(rows: ModelAggRow[]): CostByModel[] {
  const groups = new Map<string, CostByModel>();
  for (const r of rows) {
    if (r.withCost <= 0) continue;
    const key = normalizeModel(r.model);
    const g = groups.get(key) ?? { model: key, cost_usd: 0, runs_with_cost: 0 };
    g.cost_usd += r.cost ?? 0;
    g.runs_with_cost += r.withCost;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, cost_usd: roundMoney(g.cost_usd) }))
    .sort((a, b) => b.cost_usd - a.cost_usd || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
}
