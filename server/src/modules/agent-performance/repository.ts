import { and, eq, gte, inArray, isNotNull, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Period } from './period.js';
import type { DayRow, FindingAggRow, ModelAggRow, RunAggRow } from './rules.js';

/**
 * Read-only data access for the agent-performance module: SELECTs only, grouped in
 * SQL so the number of queries per request is fixed (never one per agent).
 *
 * Every query is scoped by `agent_runs.workspace_id`. `agentIds` narrows the result
 * to those agents (null = every agent); runs with a null `agent_id` (deleted agent)
 * never appear except in `deletedAgentRuns`.
 */
export class AgentPerformanceRepository {
  constructor(private db: DbOrTx) {}

  /** Per-agent run aggregates for the period. Counted = `status = 'done'`; excluded = anything else. */
  async runAggregates(workspaceId: string, period: Period, agentIds: string[] | null): Promise<RunAggRow[]> {
    const done = sql`${t.agentRuns.status} = 'done'`;
    const rows = await this.db
      .select({
        agentId: t.agentRuns.agentId,
        counted: sql<number>`(count(*) filter (where ${done}))::int`,
        excluded: sql<number>`(count(*) filter (where ${t.agentRuns.status} is distinct from 'done'))::int`,
        withCost: sql<number>`(count(${t.agentRuns.costUsd}) filter (where ${done}))::int`,
        totalCost: sql<number | null>`(sum(${t.agentRuns.costUsd}) filter (where ${done}))::float8`,
        durationSum: sql<number | null>`(sum(${t.agentRuns.durationMs}) filter (where ${done}))::float8`,
        durationCount: sql<number>`(count(${t.agentRuns.durationMs}) filter (where ${done}))::int`,
        lastRanAt: sql<Date | null>`max(${t.agentRuns.ranAt}) filter (where ${done})`.mapWith(t.agentRuns.ranAt),
      })
      .from(t.agentRuns)
      .where(this.runScope(workspaceId, period, agentIds))
      .groupBy(t.agentRuns.agentId);
    return rows.map((r) => ({
      agentId: r.agentId as string,
      counted: Number(r.counted),
      excluded: Number(r.excluded),
      withCost: Number(r.withCost),
      totalCost: r.totalCost === null ? null : Number(r.totalCost),
      durationSum: r.durationSum === null ? null : Number(r.durationSum),
      durationCount: Number(r.durationCount),
      lastRanAt: r.lastRanAt ?? null,
    }));
  }

  /** Runs in the period whose agent was deleted (`agent_id` is null): reported, never counted. */
  async deletedAgentRuns(workspaceId: string, period: Period): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          isNull(t.agentRuns.agentId),
          gte(t.agentRuns.ranAt, period.from),
          lt(t.agentRuns.ranAt, period.to),
        ),
      );
    return Number(row?.n ?? 0);
  }

  /** Latest done run per agent regardless of the period. */
  async lastDoneAllTime(workspaceId: string, agentIds: string[] | null): Promise<Map<string, Date>> {
    const rows = await this.db
      .select({ agentId: t.agentRuns.agentId, last: sql<Date>`max(${t.agentRuns.ranAt})`.mapWith(t.agentRuns.ranAt) })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.status, 'done'),
          this.agentFilter(agentIds),
        ),
      )
      .groupBy(t.agentRuns.agentId);
    return new Map(rows.flatMap((r) => (r.agentId && r.last ? [[r.agentId, r.last] as const] : [])));
  }

  /**
   * Rated findings of counted runs: finding -> review -> run (`reviews.run_id = agent_runs.id`),
   * scope `in` or null, attributed to `agent_runs.agent_id`. The decision CASE mirrors
   * `decisionOf` in rules.ts (later timestamp wins, a tie is accepted). The timestamps are compared at
   * millisecond precision (date_trunc) because JS dates have no finer resolution.
   */
  async findingAggregates(workspaceId: string, period: Period, agentIds: string[] | null): Promise<FindingAggRow[]> {
    const decision = sql<FindingAggRow['decision']>`case
      when ${t.findings.acceptedAt} is not null and ${t.findings.dismissedAt} is null then 'accepted'
      when ${t.findings.dismissedAt} is not null and ${t.findings.acceptedAt} is null then 'dismissed'
      when ${t.findings.acceptedAt} is not null and ${t.findings.dismissedAt} is not null
        then case when date_trunc('milliseconds', ${t.findings.acceptedAt}) >= date_trunc('milliseconds', ${t.findings.dismissedAt})
          then 'accepted' else 'dismissed' end
      else 'pending' end`;
    const rows = await this.db
      .select({
        agentId: t.agentRuns.agentId,
        severity: t.findings.severity,
        decision,
        n: sql<number>`count(*)::int`,
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.reviews.runId))
      .where(
        and(
          this.runScope(workspaceId, period, agentIds),
          eq(t.agentRuns.status, 'done'),
          eq(t.reviews.workspaceId, workspaceId),
          sql`(${t.findings.scope} = 'in' or ${t.findings.scope} is null)`,
        ),
      )
      // `decision` is both selected and grouped: Postgres only accepts that when both render
      // identical text, so the CASE must stay free of bound parameters (a `$n` would differ).
      .groupBy(t.agentRuns.agentId, t.findings.severity, decision);
    return rows.map((r) => ({ agentId: r.agentId as string, severity: r.severity, decision: r.decision, n: Number(r.n) }));
  }

  /** Counted runs per agent and UTC day. */
  async dayCounts(workspaceId: string, period: Period, agentIds: string[] | null): Promise<Map<string, DayRow[]>> {
    const day = sql<string>`to_char(date_trunc('day', ${t.agentRuns.ranAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
    const rows = await this.db
      .select({ agentId: t.agentRuns.agentId, day, n: sql<number>`count(*)::int` })
      .from(t.agentRuns)
      .where(and(this.runScope(workspaceId, period, agentIds), eq(t.agentRuns.status, 'done')))
      // Same rule as the decision CASE: `day` is selected and grouped, so the to_char
      // expression must stay free of bound parameters to render identically in both.
      .groupBy(t.agentRuns.agentId, day);
    const out = new Map<string, DayRow[]>();
    for (const r of rows) {
      if (!r.agentId) continue;
      const list = out.get(r.agentId) ?? [];
      list.push({ day: r.day, n: Number(r.n) });
      out.set(r.agentId, list);
    }
    return out;
  }

  /** Cost per raw `model` string over counted runs; trimming and the `unknown` bucket are applied in rules.ts. */
  async modelAggregates(workspaceId: string, period: Period, agentIds: string[] | null): Promise<ModelAggRow[]> {
    const rows = await this.db
      .select({
        model: t.agentRuns.model,
        cost: sql<number | null>`sum(${t.agentRuns.costUsd})::float8`,
        withCost: sql<number>`count(${t.agentRuns.costUsd})::int`,
      })
      .from(t.agentRuns)
      .where(and(this.runScope(workspaceId, period, agentIds), eq(t.agentRuns.status, 'done')))
      .groupBy(t.agentRuns.model);
    return rows.map((r) => ({ model: r.model, cost: r.cost === null ? null : Number(r.cost), withCost: Number(r.withCost) }));
  }

  private agentFilter(agentIds: string[] | null): SQL {
    return agentIds ? inArray(t.agentRuns.agentId, agentIds) : isNotNull(t.agentRuns.agentId);
  }

  /** Workspace + period (half-open on ran_at) + non-null agent. */
  private runScope(workspaceId: string, period: Period, agentIds: string[] | null): SQL {
    return and(
      eq(t.agentRuns.workspaceId, workspaceId),
      gte(t.agentRuns.ranAt, period.from),
      lt(t.agentRuns.ranAt, period.to),
      this.agentFilter(agentIds),
    ) as SQL;
  }
}
