import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { EvalCompare, EvalOverview, EvalRunPage, EvalSuiteRunDetail } from '@devdigest/shared';
import type { EvalCaseView } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient } from '../src/adapters/mocks.js';
import { RecordingLLM, type RecordingLLMOptions } from './helpers/recording-llm.js';
import { RAW_DIFF, fragmentWith } from './helpers/fake-eval-store.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals.it] Docker not available - skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
const PROMPT = 'You are the ORIGINAL eval reviewer.';
const HIT = { file: 'src/config.ts', start_line: 11, end_line: 11 };

d('eval pipeline (Testcontainers pg)', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let workspaceId: string;
  const apps: Array<{ close: () => Promise<unknown> }> = [];

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    await seed(db);
    [{ id: workspaceId }] = (await db.select({ id: t.workspaces.id }).from(t.workspaces)) as [{ id: string }];
  });
  afterAll(async () => {
    for (const a of apps) await a.close();
    await pg?.stop();
  });

  async function makeApp(llmOpts: RecordingLLMOptions = {}) {
    const llm = new RecordingLLM(llmOpts);
    const app = await buildApp({
      config: config(),
      db,
      overrides: { git: new MockGitClient({ diff: RAW_DIFF }), llm: { openrouter: llm } },
    });
    apps.push(app);
    return { app, llm };
  }
  type App = Awaited<ReturnType<typeof makeApp>>['app'];

  async function makeAgent(app: App, name = 'Eval Agent') {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openrouter', model: 'test/model-a', system_prompt: PROMPT },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  let seq = 0;
  /** repo + PR + review by `agentId` + one finding, accepted or dismissed. */
  async function makeFinding(agentId: string, decision: 'accepted' | 'dismissed' | null = 'accepted') {
    const n = ++seq;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `evals-${n}`, fullName: `acme/evals-${n}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({ workspaceId, repoId: repo!.id, number: n, title: 't', author: 'a', branch: 'b', base: 'main', headSha: 'abc' })
      .returning();
    const [review] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId: pr!.id, agentId, kind: 'review', model: 'm' })
      .returning();
    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        ...{ file: 'src/config.ts', startLine: 11, endLine: 11 },
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
        rationale: 'r',
        confidence: 0.9,
        acceptedAt: decision === 'accepted' ? new Date() : null,
        dismissedAt: decision === 'dismissed' ? new Date() : null,
      })
      .returning();
    return { prId: pr!.id, findingId: finding!.id };
  }

  async function createCaseFromFinding(app: App, agentId: string, name?: string) {
    const f = await makeFinding(agentId);
    const draft = await app.inject({ method: 'GET', url: `/findings/${f.findingId}/eval-case-draft` });
    expect(draft.statusCode).toBe(200);
    const body = draft.json();
    const res = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { agent_id: agentId, finding_id: f.findingId, name: name ?? body.name, expectation: body.expectation, input_diff: body.input_diff },
    });
    expect(res.statusCode).toBe(201);
    return { ...f, view: res.json() as EvalCaseView };
  }

  /** Inserts a stored case directly (distinct fragment per marker). */
  async function insertCase(agentId: string, name: string, kind: 'must_find' | 'must_not_flag', marker = name) {
    const [row] = await db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name,
        inputDiff: fragmentWith(marker),
        inputMeta: { origin: 'seeded', seed_key: `${agentId}-${name}` },
        expectedOutput: { kind, ...HIT },
      })
      .returning();
    return row!;
  }

  async function startRun(app: App, agentId: string) {
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(res.statusCode).toBe(202);
    return res.json().run_id as string;
  }

  async function waitDone(app: App, runId: string) {
    for (let i = 0; i < 400; i++) {
      const res = await app.inject({ method: 'GET', url: `/eval-runs/${runId}` });
      const run = EvalSuiteRunDetail.parse(res.json());
      if (run.status !== 'running') return run;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('eval run did not finish');
  }

  async function waitFor(cond: () => boolean) {
    for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(cond()).toBe(true);
  }

  it('create stores the row with source finding, PR and decision; a duplicate is 409 and the unique index holds', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent(app);
    const { findingId, prId, view } = await createCaseFromFinding(app, agentId);

    const [row] = await db.select().from(t.evalCases).where(eq(t.evalCases.id, view.id));
    expect(row).toMatchObject({ workspaceId, ownerKind: 'agent', ownerId: agentId });
    expect(row!.inputMeta).toEqual({
      origin: 'accepted_finding',
      source_finding_id: findingId,
      source_pr_id: prId,
      source_decision: 'accepted',
    });
    expect(row!.expectedOutput).toEqual({ kind: 'must_find', ...HIT });
    expect(row!.inputDiff).toContain('stripeKey');

    const dup = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { agent_id: agentId, finding_id: findingId, name: 'again', expectation: row!.expectedOutput, input_diff: row!.inputDiff },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.details.case_id).toBe(view.id);
    const count = await db.select({ n: sql<number>`count(*)::int` }).from(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
    expect(count[0]!.n).toBe(1);

    // The DB-level guard rejects it even if the service check were bypassed.
    await expect(
      db.insert(t.evalCases).values({
        workspaceId,
        ownerKind: 'agent',
        ownerId: agentId,
        name: 'bypass',
        inputMeta: { origin: 'accepted_finding', source_finding_id: findingId },
        expectedOutput: row!.expectedOutput,
      }),
    ).rejects.toThrow();
  });

  it('deleting the source PR leaves the case runnable', async () => {
    const { app, llm } = await makeApp();
    const agentId = await makeAgent(app);
    const { prId, view } = await createCaseFromFinding(app, agentId);
    await db.delete(t.pullRequests).where(eq(t.pullRequests.id, prId));
    expect(await db.select().from(t.pullRequests).where(eq(t.pullRequests.id, prId))).toHaveLength(0);

    const run = await waitDone(app, await startRun(app, agentId));
    expect(run.status).toBe('completed');
    expect(run.results).toHaveLength(1);
    expect(run.results[0]).toMatchObject({ case_id: view.id, status: 'ok' });
    expect(llm.calls).toHaveLength(1);
    expect(llm.userMessages()[0]).toContain('stripeKey');
  });

  it('deleting a case keeps past results and metrics (case_id null, snapshot kept)', async () => {
    const { app } = await makeApp({ findings: () => [{ ...HIT, title: 'Hit' }] });
    const agentId = await makeAgent(app);
    const keep = await insertCase(agentId, 'keep-me', 'must_find');
    await insertCase(agentId, 'other', 'must_find');
    const before = await waitDone(app, await startRun(app, agentId));
    expect(before.counts?.cases_scored).toBe(2);

    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${keep.id}` });
    expect(del.statusCode).toBe(200);
    const after = await waitDone(app, before.id);

    expect(after.metrics).toEqual(before.metrics);
    expect(after.counts).toEqual(before.counts);
    const strip = (r: (typeof before.results)[number]) => ({ ...r, case_id: null });
    expect(after.results.map(strip)).toEqual(before.results.map(strip));
    const gone = after.results.find((r) => r.case_name === 'keep-me')!;
    expect(gone.case_id).toBeNull();
    expect(gone.expectation).toEqual({ kind: 'must_find', ...HIT });
    expect(after.results.find((r) => r.case_name === 'other')!.case_id).not.toBeNull();
  });

  it('deleting an agent removes its cases, suite runs and results (and nothing else)', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent(app);
    const otherId = await makeAgent(app, 'Bystander');
    await insertCase(agentId, 'a1', 'must_find');
    await insertCase(otherId, 'b1', 'must_find');
    const runId = await startRun(app, agentId);
    await waitDone(app, runId);
    const otherRun = await waitDone(app, await startRun(app, otherId));

    const del = await app.inject({ method: 'DELETE', url: `/agents/${agentId}` });
    expect(del.statusCode).toBe(200);
    expect(await db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, agentId))).toHaveLength(0);
    expect(await db.select().from(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.agentId, agentId))).toHaveLength(0);
    expect(await db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteRunId, runId))).toHaveLength(0);
    expect(await db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, otherId))).toHaveLength(1);
    expect(await db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteRunId, otherRun.id))).toHaveLength(1);
  });

  it('stores counts and metrics that match the fixture', async () => {
    const byMarker = (call: { messages: { content: string }[] }) => call.messages[1]!.content;
    const { app } = await makeApp({
      findings: (c) => {
        const u = byMarker(c);
        if (u.includes('marker_A')) {
          return [
            { ...HIT, title: 'tp' },
            { file: 'src/config.ts', start_line: 12, end_line: 12, title: 'unl' },
            { file: 'src/missing.ts', start_line: 3, end_line: 3, title: 'dropped' },
          ];
        }
        if (u.includes('marker_B')) return [{ file: 'src/config.ts', start_line: 12, end_line: 12, title: 'unl' }];
        return [{ ...HIT, title: 'zone' }];
      },
    });
    const agentId = await makeAgent(app);
    await insertCase(agentId, 'A', 'must_find', 'marker_A');
    await insertCase(agentId, 'B', 'must_find', 'marker_B');
    await insertCase(agentId, 'C', 'must_not_flag', 'marker_C');
    const run = await waitDone(app, await startRun(app, agentId));

    const expected = {
      cases_scored: 3,
      cases_passed: 1,
      must_find_total: 2,
      must_find_hit: 1,
      must_not_flag_total: 1,
      must_not_flag_violated: 1,
      tp: 1,
      fp_zone: 1,
      fp_unlabeled: 2,
      grounded: 4,
      dropped: 1,
      cases_errored: 0,
    };
    expect(run.status).toBe('completed');
    expect(run.counts).toEqual(expected);
    expect(run.metrics).toEqual({ recall: 0.5, precision: 0.25, citation_accuracy: 0.8 });

    const [row] = await db.select().from(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.id, run.id));
    expect(row).toMatchObject({ status: 'completed', recall: 0.5, precision: 0.25, citationAccuracy: 0.8, casesTotal: 3, agentVersion: 1 });
    expect(row!.counts).toEqual(expected);
    expect(row!.finishedAt).not.toBeNull();
    expect(row!.durationMs).toBeGreaterThanOrEqual(0);
    expect(row!.costUsd).toBeCloseTo(0.003, 6);
  });

  it('stores per-case results and the three outcomes (pass, fail, error)', async () => {
    const { app } = await makeApp({
      tokensIn: 150,
      tokensOut: 25,
      costUsd: 0.004,
      findings: (c) => (c.messages[1]!.content.includes('m_pass') ? [{ ...HIT, title: 'Found it' }] : []),
      throwFor: (c) =>
        c.messages[1]!.content.includes('m_err') ? new Error('provider 500: sk-live-abcdef123456 rejected') : undefined,
    });
    const agentId = await makeAgent(app);
    await insertCase(agentId, 'pass-case', 'must_find', 'm_pass');
    await insertCase(agentId, 'fail-case', 'must_find', 'm_fail');
    await insertCase(agentId, 'error-case', 'must_find', 'm_err');
    const run = await waitDone(app, await startRun(app, agentId));
    expect(run.status).toBe('completed_with_errors');
    expect(run.counts).toMatchObject({ cases_scored: 2, cases_passed: 1, cases_errored: 1 });

    const rows = await db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteRunId, run.id));
    const by = (n: string) => rows.find((r) => (r.caseSnapshot as { name: string }).name === n)!;
    expect(by('pass-case')).toMatchObject({ status: 'ok', pass: true, tokensIn: 150, tokensOut: 25, costUsd: 0.004, error: null });
    expect(by('pass-case').durationMs).not.toBeNull();
    expect(by('pass-case').actualOutput).toMatchObject({ grounded: [{ title: 'Found it', match: 'tp', severity: 'WARNING', category: 'bug' }], dropped: [] });
    expect(by('fail-case')).toMatchObject({ status: 'ok', pass: false });
    const err = by('error-case');
    expect(err).toMatchObject({ status: 'error', pass: null, tokensIn: null });
    expect(err.error).not.toContain('sk-live-abcdef123456');
    expect(err.caseSnapshot).toEqual({ name: 'error-case', expectation: { kind: 'must_find', ...HIT }, origin: 'seeded' });
  });

  it('an agent edit made mid-run does not reach the run: every case saw the original prompt and the manifest is unchanged', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app, llm } = await makeApp({ gate });
    const agentId = await makeAgent(app);
    for (let i = 1; i <= 5; i++) await insertCase(agentId, `case-${i}`, 'must_find', `mid_${i}`);
    const runId = await startRun(app, agentId);
    await waitFor(() => llm.calls.length === 3);

    const put = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}`,
      payload: { system_prompt: 'You are the EDITED reviewer.', model: 'test/model-b' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().version).toBe(2);
    release();
    const run = await waitDone(app, runId);

    expect(run.status).toBe('completed');
    expect(llm.calls).toHaveLength(5);
    for (const sys of llm.systemMessages()) {
      expect(sys.startsWith(PROMPT)).toBe(true);
      expect(sys).not.toContain('EDITED');
    }
    expect(new Set(llm.calls.map((c) => c.model))).toEqual(new Set(['test/model-a']));
    expect(run.agent_version).toBe(1);
    expect(run.manifest).toMatchObject({ system_prompt: PROMPT, model: 'test/model-a' });
  });

  it('a run writes no agent_runs, run_traces, reviews or findings rows', async () => {
    const { app } = await makeApp({ findings: () => [{ ...HIT, title: 'x' }] });
    const agentId = await makeAgent(app);
    await createCaseFromFinding(app, agentId);
    await insertCase(agentId, 'second', 'must_not_flag');
    const count = async () => ({
      agentRuns: (await db.select({ n: sql<number>`count(*)::int` }).from(t.agentRuns))[0]!.n,
      runTraces: (await db.select({ n: sql<number>`count(*)::int` }).from(t.runTraces))[0]!.n,
      reviews: (await db.select({ n: sql<number>`count(*)::int` }).from(t.reviews))[0]!.n,
      findings: (await db.select({ n: sql<number>`count(*)::int` }).from(t.findings))[0]!.n,
    });
    const before = await count();
    await waitDone(app, await startRun(app, agentId));
    expect(await count()).toEqual(before);
  });

  it('a second run never sees the first run\'s stored results', async () => {
    const first = await makeApp({ findings: () => [{ ...HIT, title: 'FIRST_RUN_SENTINEL_e83a' }] });
    const agentId = await makeAgent(first.app);
    await insertCase(agentId, 'iso', 'must_find');
    await waitDone(first.app, await startRun(first.app, agentId));
    const second = await makeApp();
    await waitDone(second.app, await startRun(second.app, agentId));
    expect(JSON.stringify(second.llm.calls)).not.toContain('FIRST_RUN_SENTINEL_e83a');
    expect(second.llm.userMessages()).toEqual(first.llm.userMessages());
  });

  it('only one run can be running per agent (409 over the API, partial unique index in the DB)', async () => {
    const { app } = await makeApp({ gate: new Promise(() => {}) });
    const agentId = await makeAgent(app);
    await insertCase(agentId, 'c', 'must_find');
    const runId = await startRun(app, agentId);
    const again = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.details.running_run_id).toBe(runId);
    await expect(
      db.insert(t.evalSuiteRuns).values({ workspaceId, agentId, agentVersion: 1, manifest: {}, status: 'running', casesTotal: 1 }),
    ).rejects.toThrow();
    // Cleanup so the never-resolving run does not linger as 'running' for later reapers.
    await db.update(t.evalSuiteRuns).set({ status: 'failed' }).where(eq(t.evalSuiteRuns.id, runId));
  });

  it('lists cases with their last result, pages runs, and serves overview and compare from SQL', async () => {
    const { app } = await makeApp({ findings: () => [{ ...HIT, title: 'Hit' }] });
    const agentId = await makeAgent(app, 'Listing Agent');
    await insertCase(agentId, 'z-find', 'must_find');
    await insertCase(agentId, 'a-dont', 'must_not_flag');
    const r1 = await waitDone(app, await startRun(app, agentId));
    const r2 = await waitDone(app, await startRun(app, agentId));
    const r3 = await waitDone(app, await startRun(app, agentId));

    const cases = (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-cases` })).json() as EvalCaseView[];
    expect(cases.map((c) => c.name)).toEqual(['z-find', 'a-dont']);
    expect(cases[0]!.last_result).toMatchObject({ run_id: r3.id, status: 'pass', matched: 1, kind: 'must_find' });
    expect(cases[1]!.last_result).toMatchObject({ run_id: r3.id, status: 'fail', matched: 1, kind: 'must_not_flag' });

    const p1 = EvalRunPage.parse((await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs?limit=2` })).json());
    expect(p1.items.map((r) => r.id)).toEqual([r3.id, r2.id]);
    expect(p1.items[0]).toMatchObject({ cases_total: 2, cases_done: 2, agent_name: 'Listing Agent', agent_version: 1 });
    const p2 = EvalRunPage.parse(
      (await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-runs?limit=2&cursor=${encodeURIComponent(p1.next_cursor!)}` })).json(),
    );
    expect(p2.items.map((r) => r.id)).toEqual([r1.id]);
    expect(p2.next_cursor).toBeNull();

    const ov = EvalOverview.parse((await app.inject({ method: 'GET', url: '/evals/overview' })).json());
    const mine = ov.agents.find((a) => a.agent_id === agentId)!;
    expect([mine.latest?.id, mine.previous?.id]).toEqual([r3.id, r2.id]);
    expect(ov.recent.length).toBeLessThanOrEqual(6);
    expect(ov.recent[0]!.id).toBe(r3.id);

    const cmp = EvalCompare.parse((await app.inject({ method: 'GET', url: `/eval-runs/compare?a=${r3.id}&b=${r1.id}` })).json());
    expect([cmp.a.id, cmp.b.id]).toEqual([r1.id, r3.id]);
    const other = await makeAgent(app, 'Someone Else');
    await insertCase(other, 'x', 'must_find');
    const o = await waitDone(app, await startRun(app, other));
    expect((await app.inject({ method: 'GET', url: `/eval-runs/compare?a=${r1.id}&b=${o.id}` })).statusCode).toBe(400);
  });

  it('overview latest/previous ignore a newer failed run; recent still lists it (AC-51, AC-59, AC-61)', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent(app, 'Overview Agent');
    const mk = (status: 'completed' | 'completed_with_errors' | 'failed' | 'running', day: number) =>
      db
        .insert(t.evalSuiteRuns)
        .values({
          workspaceId,
          agentId,
          agentVersion: 1,
          manifest: {},
          status,
          casesTotal: 1,
          startedAt: new Date(`2031-05-0${day}T00:00:00Z`),
        })
        .returning()
        .then((r) => r[0]!);
    const older = await mk('completed', 1);
    const newer = await mk('completed_with_errors', 2);
    const failed = await mk('failed', 3);
    const running = await mk('running', 4);

    const ov = EvalOverview.parse((await app.inject({ method: 'GET', url: '/evals/overview' })).json());
    const mine = ov.agents.find((a) => a.agent_id === agentId)!;
    expect([mine.latest?.id, mine.previous?.id]).toEqual([newer.id, older.id]);
    expect(ov.recent.map((r) => r.id)).toEqual(expect.arrayContaining([running.id, failed.id]));
    expect(ov.recent[0]!.id).toBe(running.id);
    expect(ov.recent[1]!.id).toBe(failed.id);
    await db.update(t.evalSuiteRuns).set({ status: 'failed' }).where(eq(t.evalSuiteRuns.id, running.id));
  });

  it('another workspace\'s agent, case and run are invisible and untouched through the real routes (AC-79)', async () => {
    const { app, llm } = await makeApp();
    const [wsB] = await db.insert(t.workspaces).values({ name: 'Other WS' }).returning();
    const [agentB] = await db
      .insert(t.agents)
      .values({ workspaceId: wsB!.id, name: 'B Agent', provider: 'openrouter', model: 'test/model-a', systemPrompt: 'B prompt' })
      .returning();
    const [caseB] = await db
      .insert(t.evalCases)
      .values({
        workspaceId: wsB!.id,
        ownerKind: 'agent',
        ownerId: agentB!.id,
        name: 'b-case',
        inputDiff: fragmentWith('b'),
        inputMeta: { origin: 'seeded', seed_key: 'b' },
        expectedOutput: { kind: 'must_find', ...HIT },
      })
      .returning();
    const [runB] = await db
      .insert(t.evalSuiteRuns)
      .values({ workspaceId: wsB!.id, agentId: agentB!.id, agentVersion: 1, manifest: {}, status: 'completed', casesTotal: 1 })
      .returning();
    await db.insert(t.evalRuns).values({
      caseId: caseB!.id,
      suiteRunId: runB!.id,
      status: 'ok',
      pass: true,
      actualOutput: { grounded: [], dropped: [] },
      caseSnapshot: { name: 'b-case', expectation: { kind: 'must_find', ...HIT }, origin: 'seeded' },
    });

    const agentA = await makeAgent(app, 'A Agent');
    await insertCase(agentA, 'a-case', 'must_find');
    const runA = await waitDone(app, await startRun(app, agentA));
    const callsBefore = llm.calls.length;

    const get = (url: string) => app.inject({ method: 'GET', url });
    expect((await get(`/agents/${agentB!.id}/eval-cases`)).statusCode).toBe(404);
    expect((await get(`/agents/${agentB!.id}/eval-runs`)).statusCode).toBe(404);
    expect((await get(`/eval-runs/${runB!.id}`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/eval-cases/${caseB!.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/agents/${agentB!.id}/eval-runs` })).statusCode).toBe(404);
    expect((await get(`/eval-runs/compare?a=${runA.id}&b=${runB!.id}`)).statusCode).toBe(404);
    expect((await get(`/eval-runs/compare?a=${runB!.id}&b=${runA.id}`)).statusCode).toBe(404);

    const ov = EvalOverview.parse((await get('/evals/overview')).json());
    expect(ov.agents.map((a) => a.agent_id)).not.toContain(agentB!.id);
    expect(ov.recent.map((r) => r.id)).not.toContain(runB!.id);

    // Nothing of workspace B changed and no model call was made on its behalf.
    expect(llm.calls).toHaveLength(callsBefore);
    expect(await db.select().from(t.evalCases).where(eq(t.evalCases.id, caseB!.id))).toHaveLength(1);
    expect(await db.select().from(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.agentId, agentB!.id))).toHaveLength(1);
  });

  it('on boot, a run left running becomes failed "interrupted" and keeps its finished results', async () => {
    const { app } = await makeApp();
    const agentId = await makeAgent(app);
    const c1 = await insertCase(agentId, 'done', 'must_find');
    const c2 = await insertCase(agentId, 'pending', 'must_find');
    const [suite] = await db
      .insert(t.evalSuiteRuns)
      .values({ workspaceId, agentId, agentVersion: 1, manifest: { provider: 'openrouter' }, status: 'running', casesTotal: 2 })
      .returning();
    await db.insert(t.evalRuns).values([
      {
        caseId: c1.id,
        suiteRunId: suite!.id,
        status: 'ok',
        pass: true,
        actualOutput: { grounded: [], dropped: [] },
        caseSnapshot: { name: 'done', expectation: { kind: 'must_find', ...HIT }, origin: 'seeded' },
      },
      {
        caseId: c2.id,
        suiteRunId: suite!.id,
        status: 'pending',
        caseSnapshot: { name: 'pending', expectation: { kind: 'must_find', ...HIT }, origin: 'seeded' },
      },
    ]);

    await makeApp(); // a fresh process boots against the same database

    const [after] = await db.select().from(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.id, suite!.id));
    expect(after).toMatchObject({ status: 'failed', error: 'interrupted' });
    expect(after!.finishedAt).not.toBeNull();
    const rows = await db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteRunId, suite!.id));
    const status = (n: string) => rows.find((r) => (r.caseSnapshot as { name: string }).name === n)!;
    expect(status('done')).toMatchObject({ status: 'ok', pass: true, error: null });
    expect(status('pending')).toMatchObject({ status: 'error', error: 'interrupted' });
    const running = await db.select().from(t.evalSuiteRuns).where(and(eq(t.evalSuiteRuns.agentId, agentId), eq(t.evalSuiteRuns.status, 'running')));
    expect(running).toHaveLength(0);
  });
});
