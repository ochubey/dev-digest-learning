/**
 * Agent performance aggregation against real Postgres (Testcontainers). Skipped
 * without Docker. Pins the SQL (grouping, period bounds, finding attribution, the
 * decision CASE) to the pure rules in rules.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { AgentStats } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import * as t from '../src/db/schema.js';
import { decisionOf } from '../src/modules/agent-performance/rules.js';
import { AgentPerformance } from '../src/modules/agent-performance/schemas.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agent-performance] Docker not available - skipping integration tests.');
}

const at = (s: string) => new Date(s);
const FROM = '2026-09-10T00:00:00.000Z';
const TO = '2026-09-20T00:00:00.000Z';
const qs = (from: string, to: string) => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

d('agent performance (DB)', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let app: Awaited<ReturnType<typeof buildApp>>;
  let currentWs: string;
  let ws1: string;
  let ws2: string;
  let alpha: string;
  let beta: string;
  let never: string;
  let beforeOnly: string;
  let foreign: string;
  /** rated findings expected per agent, computed with the TS decisionOf rule */
  const expectedByAgent = new Map<string, { accepted: number; dismissed: number; pending: number }>();

  async function mkAgent(ws: string, name: string) {
    const [row] = await db
      .insert(t.agents)
      .values({ workspaceId: ws, name, provider: 'openrouter', model: 'm/x', systemPrompt: 'p' })
      .returning();
    return row!.id;
  }

  async function mkRepoPr(ws: string, slug: string) {
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name: slug, fullName: `acme/${slug}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({ workspaceId: ws, repoId: repo!.id, number: 1, title: 'T', author: 'a', branch: 'b', base: 'main', headSha: 'x'.repeat(40) })
      .returning();
    return pr!.id;
  }

  type RunOver = Partial<typeof t.agentRuns.$inferInsert>;
  async function mkRun(ws: string, agentId: string | null, ranAt: string, o: RunOver = {}) {
    const [row] = await db
      .insert(t.agentRuns)
      .values({
        workspaceId: ws, agentId, ranAt: at(ranAt), status: 'done', source: 'local',
        model: 'm1', costUsd: null, durationMs: null, ...o,
      })
      .returning();
    return row!.id;
  }

  async function mkReview(ws: string, prId: string, agentId: string | null, runId: string | null) {
    const [row] = await db.insert(t.reviews).values({ workspaceId: ws, prId, agentId, runId, kind: 'review' }).returning();
    return row!.id;
  }

  type FOver = { severity?: string; scope?: 'in' | 'out' | 'signal' | null; acc?: string; dis?: string };
  /** Insert a finding; if `track` is given, tally its decision (by the TS rule) for that agent when rated. */
  async function mkFinding(reviewId: string, o: FOver, track?: string) {
    const acceptedAt = o.acc ? at(o.acc) : null;
    const dismissedAt = o.dis ? at(o.dis) : null;
    await db.insert(t.findings).values({
      reviewId, file: 'a.ts', startLine: 1, endLine: 1, severity: o.severity ?? 'WARNING', category: 'bug',
      title: 'x', rationale: 'y', confidence: 0.9, scope: o.scope === undefined ? 'in' : o.scope, acceptedAt, dismissedAt,
    });
    if (track && (o.scope === undefined || o.scope === 'in' || o.scope === null)) {
      const cur = expectedByAgent.get(track) ?? { accepted: 0, dismissed: 0, pending: 0 };
      cur[decisionOf({ acceptedAt, dismissedAt })] += 1;
      expectedByAgent.set(track, cur);
    }
  }

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    [{ id: ws1 }] = (await db.insert(t.workspaces).values({ name: 'perf-1' }).returning()) as [{ id: string }];
    [{ id: ws2 }] = (await db.insert(t.workspaces).values({ name: 'perf-2' }).returning()) as [{ id: string }];
    currentWs = ws1;
    const pr1 = await mkRepoPr(ws1, 'one');
    const pr2 = await mkRepoPr(ws2, 'two');

    alpha = await mkAgent(ws1, 'Alpha');
    beta = await mkAgent(ws1, 'Beta');
    never = await mkAgent(ws1, 'Never');
    beforeOnly = await mkAgent(ws1, 'Before only');
    foreign = await mkAgent(ws2, 'Foreign');

    // ---- Alpha: boundaries, statuses, sources
    const r1 = await mkRun(ws1, alpha, FROM, { costUsd: 0.01, durationMs: 1000, model: 'm1' }); // at from: in
    await mkRun(ws1, alpha, '2026-09-12T10:00:00.000Z', { costUsd: 0.02, durationMs: 3000, model: ' m1 ', source: 'ci' });
    await mkRun(ws1, alpha, '2026-09-19T23:59:59.999Z', { model: null }); // to - 1 ms: in, no cost, no duration
    await mkRun(ws1, alpha, TO, { costUsd: 5, durationMs: 777 }); // at to: out (but the latest done run ever)
    const rBefore = await mkRun(ws1, alpha, '2026-09-09T23:59:59.999Z', { costUsd: 6 }); // before from: out
    const rFailed = await mkRun(ws1, alpha, '2026-09-13T00:00:00.000Z', { status: 'failed', costUsd: 9, durationMs: 9999 });
    await mkRun(ws1, alpha, '2026-09-13T01:00:00.000Z', { status: 'cancelled', costUsd: 9 });
    await mkRun(ws1, alpha, '2026-09-13T02:00:00.000Z', { status: 'running' });
    await mkRun(ws1, alpha, '2026-09-13T03:00:00.000Z', { status: null });

    // ---- Beta
    const r10 = await mkRun(ws1, beta, '2026-09-15T00:00:00.000Z', { costUsd: 0.04, durationMs: 5000, model: 'm2' });
    await mkRun(ws1, beta, '2026-09-16T00:00:00.000Z', { model: '' });
    await mkRun(ws1, beta, '2026-09-17T00:00:00.000Z', { costUsd: 0.005, model: '  ' });

    // ---- an agent whose only done run is before the period
    await mkRun(ws1, beforeOnly, '2026-08-01T08:00:00.000Z');

    // ---- a deleted agent: its run keeps existing with agent_id set null by the FK
    const gone = await mkAgent(ws1, 'Gone');
    await mkRun(ws1, gone, '2026-09-14T00:00:00.000Z', { costUsd: 7 });
    await db.delete(t.agents).where(eq(t.agents.id, gone));
    await mkRun(ws1, null, '2026-08-01T00:00:00.000Z', { costUsd: 7 }); // null agent, outside the period

    // ---- other workspace: huge numbers that must never leak into ws1
    const fr = await mkRun(ws2, foreign, '2026-09-14T00:00:00.000Z', { costUsd: 1000, durationMs: 1, model: 'm1' });
    const frv = await mkReview(ws2, pr2, foreign, fr);
    for (let i = 0; i < 6; i++) await mkFinding(frv, { acc: '2026-09-15T00:00:00.000Z' });

    // ---- findings of Alpha's counted run r1: one per scope value, plus decision combos
    const rv1 = await mkReview(ws1, pr1, alpha, r1);
    await mkFinding(rv1, { severity: 'SUGGESTION', acc: '2026-09-15T00:00:00.000Z' }, alpha); // accepted
    await mkFinding(rv1, { scope: null, dis: '2026-09-15T00:00:00.000Z' }, alpha); // legacy null scope: rated, dismissed
    await mkFinding(rv1, { scope: 'out', acc: '2026-09-15T00:00:00.000Z' }, alpha); // not rated
    await mkFinding(rv1, { scope: 'signal', acc: '2026-09-15T00:00:00.000Z' }, alpha); // not rated
    await mkFinding(rv1, { severity: 'CRITICAL' }, alpha); // pending
    await mkFinding(rv1, { acc: '2026-09-16T00:00:00.000Z', dis: '2026-09-15T00:00:00.000Z' }, alpha); // both, accepted later
    await mkFinding(rv1, { acc: '2026-09-15T00:00:00.000Z', dis: '2026-09-16T00:00:00.000Z' }, alpha); // both, dismissed later
    await mkFinding(rv1, { acc: '2026-09-15T00:00:00.000Z', dis: '2026-09-15T00:00:00.000Z' }, alpha); // tie: accepted
    // findings that must NOT be rated: failed run, run before the period, review without a run
    await mkFinding(await mkReview(ws1, pr1, alpha, rFailed), { acc: '2026-09-15T00:00:00.000Z' });
    await mkFinding(await mkReview(ws1, pr1, alpha, rBefore), { acc: '2026-09-15T00:00:00.000Z' });
    await mkFinding(await mkReview(ws1, pr1, alpha, null), { acc: '2026-09-15T00:00:00.000Z' });
    // Beta
    const rv10 = await mkReview(ws1, pr1, beta, r10);
    await mkFinding(rv10, { acc: '2026-09-16T00:00:00.000Z' }, beta);
    await mkFinding(rv10, { acc: '2026-09-16T00:00:00.000Z' }, beta);

    currentWs = ws1;
    app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv),
      db,
      overrides: { auth: { currentUser: async () => ({ id: 'u1' }), currentWorkspace: async () => ({ id: currentWs }) } as never },
    });
  });

  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  const dashboard = async (from = FROM, to = TO) => {
    const res = await app.inject({ method: 'GET', url: `/agent-performance?${qs(from, to)}` });
    expect(res.statusCode).toBe(200);
    return AgentPerformance.parse(res.json());
  };
  const stats = async (id: string, from = FROM, to = TO) => {
    const res = await app.inject({ method: 'GET', url: `/agents/${id}/stats?${qs(from, to)}` });
    expect(res.statusCode).toBe(200);
    return AgentStats.parse(res.json());
  };

  it('counts only done, non-null-agent, in-period runs of both sources (AC-1, AC-4)', async () => {
    const a = await stats(alpha);
    // in: at from, ci run, to-1ms. out: at to, before from. excluded: failed, cancelled, running, null status.
    expect(a.runs).toBe(3);
    expect(a.runs_excluded).toBe(4);
  });

  it('excluded runs change nothing but their count (AC-2)', async () => {
    const a = await stats(alpha);
    expect(a.runs_with_cost).toBe(2);
    expect(a.runs_without_cost).toBe(1);
    expect(a.total_cost_usd).toBeCloseTo(0.03, 9); // not 0.03 + 9 + 9
    expect(a.avg_cost_usd).toBeCloseTo(0.015, 9);
    expect(a.avg_latency_ms).toBe(2000); // null duration ignored, failed 9999 ignored
  });

  it('reports runs of a deleted agent only in totals.deleted_agent_runs (AC-3)', async () => {
    const dash = await dashboard();
    expect(dash.totals.deleted_agent_runs).toBe(1); // the out-of-period null-agent run is not counted
    expect(dash.totals.total_cost_usd).toBeCloseTo(0.075, 9); // the 7.0 runs are in no total
    expect(dash.agents.map((x) => x.agent_name)).not.toContain('Gone');
  });

  it('rates only in/null-scope findings of counted runs and classifies them like decisionOf (AC-5, AC-6)', async () => {
    const a = await stats(alpha);
    const exp = expectedByAgent.get(alpha)!;
    expect(exp).toEqual({ accepted: 3, dismissed: 2, pending: 1 }); // sanity of the TS side
    expect({ accepted: a.accepted, dismissed: a.dismissed, pending: a.pending }).toEqual(exp);
    expect(a.findings_total).toBe(6);
    expect(a.decisions).toBe(5);
    expect(a.low_sample).toBe(false);
    expect(a.accept_rate).toBeCloseTo(0.6, 9);
    expect(a.findings_by_severity).toEqual({ CRITICAL: 1, WARNING: 4, SUGGESTION: 1 });
    const b = await stats(beta);
    expect({ accepted: b.accepted, dismissed: b.dismissed, pending: b.pending }).toEqual(expectedByAgent.get(beta));
    expect(b.low_sample).toBe(true);
  });

  it('trend has one point per UTC day with the counted runs of that day (AC-15)', async () => {
    const a = await stats(alpha);
    expect(a.trend).toHaveLength(10);
    expect(a.trend[0]).toEqual({ label: '2026-09-10', value: 1 });
    expect(a.trend.find((p) => p.label === '2026-09-12')!.value).toBe(1);
    expect(a.trend[9]).toEqual({ label: '2026-09-19', value: 1 });
    expect(a.trend.reduce((s, p) => s + p.value, 0)).toBe(a.runs);
  });

  it('last_run_at vs last_run_at_all_time (AC-14)', async () => {
    const a = await stats(alpha);
    expect(a.last_run_at).toBe('2026-09-19T23:59:59.999Z');
    expect(a.last_run_at_all_time).toBe(TO); // the done run exactly at `to` is outside the period but is the latest ever
    const b = await stats(beforeOnly);
    expect(b).toMatchObject({ runs: 0, last_run_at: null, last_run_at_all_time: '2026-08-01T08:00:00.000Z' });
    expect(await stats(never)).toMatchObject({ runs: 0, last_run_at: null, last_run_at_all_time: null, accept_rate: null, avg_cost_usd: null });
  });

  it('dashboard totals, most-active and breakdowns (AC-24..AC-29)', async () => {
    const dash = await dashboard();
    expect(dash.agents).toHaveLength(4); // every agent of the workspace, none of the other one
    expect(dash.totals).toMatchObject({
      runs: 6, runs_excluded: 4, deleted_agent_runs: 1, runs_with_cost: 4, runs_without_cost: 2,
      accepted: 5, dismissed: 2, decisions: 7, low_sample: false,
    });
    expect(dash.totals.accept_rate).toBeCloseTo(5 / 7, 9);
    expect(dash.most_active).toEqual({ agent_id: alpha, agent_name: 'Alpha', runs: 3 }); // 3 vs 3, name tie-break
    expect(dash.cost_by_agent.map((c) => c.agent_name)).toEqual(['Beta', 'Alpha']);
    expect(dash.cost_by_model).toEqual([
      expect.objectContaining({ model: 'm2' }),
      expect.objectContaining({ model: 'm1' }), // 'm1' and ' m1 ' merged
      expect.objectContaining({ model: 'unknown' }), // '  ' (blank)
    ]);
    const sum = (xs: { cost_usd: number }[]) => xs.reduce((s, x) => s + x.cost_usd, 0);
    expect(sum(dash.cost_by_agent)).toBeCloseTo(dash.totals.total_cost_usd!, 9);
    expect(sum(dash.cost_by_model)).toBeCloseTo(dash.totals.total_cost_usd!, 9);
  });

  it('never counts the other workspace, and the other workspace sees only its own (AC-74)', async () => {
    const dash1 = await dashboard();
    expect(dash1.totals.total_cost_usd).toBeLessThan(1);
    expect(dash1.agents.map((a) => a.agent_id)).not.toContain(foreign);
    expect((await app.inject({ method: 'GET', url: `/agents/${foreign}/stats?${qs(FROM, TO)}` })).statusCode).toBe(404);
    currentWs = ws2;
    try {
      const dash2 = await dashboard();
      expect(dash2.agents.map((a) => a.agent_id)).toEqual([foreign]);
      expect(dash2.totals).toMatchObject({ runs: 1, accepted: 6, deleted_agent_runs: 0 });
      expect(dash2.totals.total_cost_usd).toBe(1000);
    } finally {
      currentWs = ws1;
    }
  });

  it('every dashboard entry equals GET /agents/:id/stats for 1 day, 30 days and a custom period (AC-20)', async () => {
    const periods: [string, string][] = [
      ['2026-09-19T00:00:00.000Z', TO], // 1 day
      ['2026-08-21T00:00:00.000Z', TO], // 30 days
      ['2026-09-12T00:00:00.000Z', '2026-09-16T00:00:00.000Z'], // custom
    ];
    for (const [from, to] of periods) {
      const dash = await dashboard(from, to);
      expect(dash.agents).toHaveLength(4);
      for (const entry of dash.agents) {
        expect(await stats(entry.agent_id, from, to)).toEqual(entry);
      }
    }
  });

  it('a period without runs gives zeros and an empty-looking dashboard, not an error', async () => {
    const dash = await dashboard('2030-01-01T00:00:00.000Z', '2030-01-08T00:00:00.000Z');
    expect(dash.totals).toMatchObject({ runs: 0, runs_excluded: 0, total_cost_usd: null, accept_rate: null });
    expect(dash.most_active).toBeNull();
    expect(dash.cost_by_agent).toEqual([]);
    expect(dash.cost_by_model).toEqual([]);
  });

  it('GETs write nothing: row contents of the touched tables are unchanged (AC-71)', async () => {
    const snapshot = async () => {
      const out: string[] = [];
      for (const table of ['agent_runs', 'reviews', 'findings', 'agents', 'workspaces']) {
        const rows = await db.execute(
          sql`select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from ${sql.raw(table)} x`,
        );
        out.push(`${table}:${JSON.stringify(rows[0])}`);
      }
      return out;
    };
    const before = await snapshot();
    await dashboard();
    await dashboard('2026-08-21T00:00:00.000Z', TO);
    await stats(alpha);
    await stats(never);
    expect(await snapshot()).toEqual(before);
  });
});
