/**
 * Eval routes via app.inject(). The repository is replaced by an in-memory store
 * (prototype spies, as in project-context-routes.test.ts); the LLM is a recording stub.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  EvalCaseDraft,
  EvalCaseView,
  EvalCompare,
  EvalOverview,
  EvalRunPage,
  EvalSuiteRunDetail,
} from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { MockGitClient } from '../src/adapters/mocks.js';
import { RecordingLLM, type RecordingLLMOptions } from './helpers/recording-llm.js';
import {
  AGENT2_ID,
  AGENT_ID,
  FINDING_ID,
  FINDING_OUT_ID,
  FINDING_UNDECIDED_ID,
  FRAGMENT,
  OTHER_AGENT_ID,
  OTHER_FINDING_ID,
  OTHER_WS,
  RAW_DIFF,
  UNKNOWN,
  WS,
  fragmentWith,
  seedStore,
  spyOnEvalsRepository,
  type FakeEvalStore,
} from './helpers/fake-eval-store.js';

const baseEnv = { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv;
const fakeAuth = { currentUser: async () => ({ id: 'u1' }), currentWorkspace: async () => ({ id: WS }) };

let closeApp: (() => Promise<void>) | null = null;
let store: FakeEvalStore;
beforeEach(() => {
  store = seedStore();
});
afterEach(async () => {
  await closeApp?.();
  closeApp = null;
  vi.restoreAllMocks();
});

async function setup(
  opts: { llm?: RecordingLLM; env?: Partial<NodeJS.ProcessEnv>; noKey?: boolean } = {},
) {
  spyOnEvalsRepository(store);
  const llm = opts.llm ?? new RecordingLLM();
  const app = await buildApp({
    config: loadConfig({ ...baseEnv, ...opts.env } as NodeJS.ProcessEnv),
    db: {} as Db,
    overrides: {
      auth: fakeAuth as never,
      git: new MockGitClient({ diff: RAW_DIFF }),
      ...(opts.noKey ? { secrets: { get: async () => undefined } } : { llm: { openrouter: llm } }),
    },
  });
  closeApp = () => app.close();
  return { app, llm };
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};
const settled = (id: string) => () => store.runs.get(id)!.status !== 'running';

const validBody = (over: Record<string, unknown> = {}) => ({
  agent_id: AGENT_ID,
  finding_id: FINDING_ID,
  name: 'hardcoded-stripe-key',
  expectation: { kind: 'must_find', file: 'src/config.ts', start_line: 11, end_line: 11 },
  input_diff: FRAGMENT,
  notes: null,
  ...over,
});

describe('GET /findings/:id/eval-case-draft', () => {
  it('returns a draft that parses and writes nothing', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: `/findings/${FINDING_ID}/eval-case-draft` });
    expect(res.statusCode).toBe(200);
    const draft = EvalCaseDraft.parse(res.json());
    expect(draft).toMatchObject({
      finding_id: FINDING_ID,
      agent_id: AGENT_ID,
      origin: 'accepted_finding',
      expectation: { kind: 'must_find', file: 'src/config.ts', start_line: 11, end_line: 11 },
    });
    expect(draft.input_diff).toContain('@@ -10,3 +10,4 @@');
    expect(store.writes).toEqual([]);
  });

  it('answers 422 with the not-in-diff message when no hunk intersects', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: `/findings/${FINDING_OUT_ID}/eval-case-draft` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: 'finding_not_in_diff',
      message: "The finding's lines are no longer in the PR diff",
    });
    expect(store.writes).toEqual([]);
  });

  it('answers 409 for an undecided finding', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: `/findings/${FINDING_UNDECIDED_ID}/eval-case-draft` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('finding_undecided');
  });
});

describe('POST /eval-cases', () => {
  it('creates a case from a finding and stores its meta', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/eval-cases', payload: validBody({ name: '  my case  ' }) });
    expect(res.statusCode).toBe(201);
    const view = EvalCaseView.parse(res.json());
    expect(view).toMatchObject({ agent_id: AGENT_ID, name: 'my case', origin: 'accepted_finding', source_finding_id: FINDING_ID });
    const stored = [...store.cases.values()][0]!;
    expect(stored.meta).toMatchObject({ source_finding_id: FINDING_ID, source_decision: 'accepted' });
    expect(stored.meta.source_pr_id).toBeTruthy();
  });

  it('answers 400 with one reason per problem and writes nothing', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: validBody({
        name: '',
        expectation: { kind: 'maybe', file: 'src/config.ts', start_line: 0, end_line: 3 },
        input_diff: '',
      }),
    });
    expect(res.statusCode).toBe(400);
    const { code, details } = res.json().error;
    expect(code).toBe('invalid_eval_case');
    expect(details.reasons).toEqual(
      expect.arrayContaining([
        'name must not be empty',
        'kind must be must_find or must_not_flag',
        'start_line must be an integer >= 1',
        'diff fragment must not be empty',
      ]),
    );
    expect(store.cases.size).toBe(0);
    expect(store.writes).toEqual([]);
  });

  it('rejects a range outside the fragment and an agent that did not produce the finding', async () => {
    const { app } = await setup();
    const outside = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: validBody({ expectation: { kind: 'must_find', file: 'src/config.ts', start_line: 50, end_line: 51 } }),
    });
    expect(outside.statusCode).toBe(400);
    expect(outside.json().error.details.reasons).toEqual(['line range does not intersect a hunk of the file']);
    const wrongAgent = await app.inject({ method: 'POST', url: '/eval-cases', payload: validBody({ agent_id: AGENT2_ID }) });
    expect(wrongAgent.statusCode).toBe(400);
    expect(store.writes).toEqual([]);
  });

  it('answers 409 for a duplicate (same agent and finding) and leaves rows unchanged', async () => {
    const { app } = await setup();
    const first = await app.inject({ method: 'POST', url: '/eval-cases', payload: validBody() });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/eval-cases', payload: validBody() });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({ code: 'eval_case_exists', details: { case_id: first.json().id } });
    expect(store.cases.size).toBe(1);
    expect(store.writes).toEqual(['insertCase']);
  });

  it('answers 409 when the DB unique index wins the race', async () => {
    const { app } = await setup();
    const real = store.insertCase.bind(store);
    vi.spyOn(store, 'insertCase').mockImplementationOnce(async (v) => {
      await real(v);
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });
    const res = await app.inject({ method: 'POST', url: '/eval-cases', payload: validBody() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('eval_case_exists');
  });

  it('answers 400 for malformed ids and 404 for unknown ones', async () => {
    const { app } = await setup();
    const bad = await app.inject({ method: 'POST', url: '/eval-cases', payload: validBody({ finding_id: 'nope' }) });
    expect(bad.statusCode).toBe(400);
    const unknown = await app.inject({ method: 'POST', url: '/eval-cases', payload: validBody({ finding_id: UNKNOWN }) });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('cases list and delete', () => {
  it('lists an agent\'s cases ordered by kind then name, and deletes one', async () => {
    const { app } = await setup();
    store.addCase({ name: 'b-find' });
    store.addCase({ name: 'a-find' });
    const dont = store.addCase({ name: 'a-dont', expectation: { kind: 'must_not_flag', file: 'src/config.ts', start_line: 11, end_line: 11 } });
    const res = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/eval-cases` });
    expect(res.statusCode).toBe(200);
    const list = EvalCaseView.array().parse(res.json());
    expect(list.map((c) => c.name)).toEqual(['a-find', 'b-find', 'a-dont']);
    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${dont.id}` });
    expect(del.json()).toEqual({ ok: true });
    expect(store.cases.size).toBe(2);
  });
});

describe('POST /agents/:id/eval-runs', () => {
  it('answers 202 with a running run and one pending result per case, before the provider resolves', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const llm = new RecordingLLM({ gate });
    const { app } = await setup({ llm });
    for (const n of ['c1', 'c2', 'c3']) store.addCase({ name: n, input_diff: fragmentWith(n) });
    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/eval-runs` });
    expect(res.statusCode).toBe(202);
    const runId = res.json().run_id as string;

    // The response is out while the provider is still blocked.
    const detail = EvalSuiteRunDetail.parse((await app.inject({ method: 'GET', url: `/eval-runs/${runId}` })).json());
    expect(detail).toMatchObject({ status: 'running', agent_version: 3, cases_total: 3, cases_done: 0 });
    expect(detail.results.map((r) => r.status)).toEqual(['pending', 'pending', 'pending']);
    expect(detail.manifest).toMatchObject({ model: 'test/model-a', system_prompt: 'You are the original reviewer.' });

    release();
    await waitFor(settled(runId));
    const done = EvalSuiteRunDetail.parse((await app.inject({ method: 'GET', url: `/eval-runs/${runId}` })).json());
    expect(done).toMatchObject({ status: 'completed', cases_done: 3 });
    expect(done.counts).not.toBeNull();
    expect(llm.calls).toHaveLength(3);
  });

  it('answers 409 with the running run id and creates nothing when one is running', async () => {
    const llm = new RecordingLLM({ gate: new Promise(() => {}) });
    const { app } = await setup({ llm });
    store.addCase({ name: 'c1' });
    const first = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/eval-runs` });
    expect(first.statusCode).toBe(202);
    const writesBefore = store.writes.length;
    const second = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/eval-runs` });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({ code: 'eval_run_running', details: { running_run_id: first.json().run_id } });
    expect(store.writes).toHaveLength(writesBefore);
    expect(store.runs.size).toBe(1);
  });

  it('answers 409 when the DB partial unique index rejects a concurrent start', async () => {
    const { app } = await setup();
    store.addCase({ name: 'c1' });
    store.createError = Object.assign(new Error('unique'), { code: '23505' });
    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/eval-runs` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('eval_run_running');
  });

  it('answers 400 "No eval cases for this agent" for an agent without cases and creates nothing', async () => {
    const { app, llm } = await setup();
    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/eval-runs` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('No eval cases for this agent');
    expect(store.writes).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  it('answers 400 naming the limit of 50 for 51 cases and creates nothing', async () => {
    const { app } = await setup();
    for (let i = 0; i < 51; i++) store.addCase({ name: `c${i}` });
    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/eval-runs` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('50');
    expect(store.writes).toEqual([]);
  });

  it('with no provider key answers the container\'s config_error unchanged and writes nothing (A-2)', async () => {
    const { app } = await setup({ noKey: true });
    store.addCase({ name: 'c1' });
    const expected = await app.container.llm('openrouter').catch((e: Error) => e);
    expect(expected).toBeInstanceOf(Error);
    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/eval-runs` });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toMatchObject({ code: 'config_error', message: (expected as Error).message });
    expect(store.writes).toEqual([]);
    expect(store.runs.size).toBe(0);
  });

  it('records a failed run when execution cannot persist, without crashing the server', async () => {
    const { app } = await setup();
    store.addCase({ name: 'c1' });
    vi.spyOn(store, 'saveCaseResult').mockRejectedValue(new Error('db down'));
    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/eval-runs` });
    expect(res.statusCode).toBe(202);
    const id = res.json().run_id as string;
    await waitFor(settled(id));
    expect(store.runs.get(id)).toMatchObject({ status: 'failed', error: 'db down' });
  });
});

describe('rate limit (NODE_ENV=development)', () => {
  it('answers 429 after 10 starts per minute', async () => {
    const llm = new RecordingLLM({ gate: new Promise(() => {}) });
    const { app } = await setup({ llm, env: { NODE_ENV: 'development' } });
    store.addCase({ name: 'c1' });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/eval-runs` })).statusCode);
    }
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('workspace isolation and ids', () => {
  it('answers 404 on every endpoint for another workspace\'s ids, with no other reads or writes', async () => {
    const { app, llm } = await setup();
    const foreignCase = store.addCase({ name: 'f', workspaceId: OTHER_WS, agent_id: OTHER_AGENT_ID });
    const foreignRun = store.addRun({ agentId: OTHER_AGENT_ID, workspaceId: OTHER_WS });
    const mine = store.addRun({ agentId: AGENT_ID });
    const calls: [string, string, unknown?][] = [
      ['GET', `/findings/${OTHER_FINDING_ID}/eval-case-draft`],
      ['POST', '/eval-cases', validBody({ agent_id: OTHER_AGENT_ID, finding_id: OTHER_FINDING_ID })],
      ['POST', '/eval-cases', validBody({ agent_id: OTHER_AGENT_ID })],
      ['POST', '/eval-cases', validBody({ finding_id: OTHER_FINDING_ID })],
      ['GET', `/agents/${OTHER_AGENT_ID}/eval-cases`],
      ['DELETE', `/eval-cases/${foreignCase.id}`],
      ['POST', `/agents/${OTHER_AGENT_ID}/eval-runs`],
      ['GET', `/agents/${OTHER_AGENT_ID}/eval-runs`],
      ['GET', `/eval-runs/${foreignRun.id}`],
      ['GET', `/eval-runs/compare?a=${foreignRun.id}&b=${mine.id}`],
      ['GET', `/eval-runs/compare?a=${mine.id}&b=${foreignRun.id}`],
    ];
    for (const [method, url, payload] of calls) {
      const res = await app.inject({ method: method as 'GET', url, ...(payload ? { payload: payload as object } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(JSON.stringify(res.json())).not.toContain(OTHER_WS);
    }
    expect(store.writes).toEqual([]);
    expect(store.cases.has(foreignCase.id)).toBe(true);
    expect(llm.calls).toHaveLength(0);
    // The overview is scoped too: nothing of the other workspace appears.
    const ov = EvalOverview.parse((await app.inject({ method: 'GET', url: '/evals/overview' })).json());
    expect(ov.agents.map((a) => a.agent_id)).not.toContain(OTHER_AGENT_ID);
    expect(ov.recent.map((r) => r.id)).not.toContain(foreignRun.id);
  });

  it('answers 404 for unknown uuids and 422 for non-uuid path ids', async () => {
    const { app } = await setup();
    for (const [method, url] of [
      ['GET', `/findings/${UNKNOWN}/eval-case-draft`],
      ['GET', `/agents/${UNKNOWN}/eval-cases`],
      ['DELETE', `/eval-cases/${UNKNOWN}`],
      ['POST', `/agents/${UNKNOWN}/eval-runs`],
      ['GET', `/agents/${UNKNOWN}/eval-runs`],
      ['GET', `/eval-runs/${UNKNOWN}`],
      ['GET', `/eval-runs/compare?a=${UNKNOWN}&b=${UNKNOWN}`],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode, url).toBe(404);
    }
    for (const [method, url] of [
      ['GET', '/findings/not-a-uuid/eval-case-draft'],
      ['GET', '/agents/not-a-uuid/eval-cases'],
      ['DELETE', '/eval-cases/not-a-uuid'],
      ['POST', '/agents/not-a-uuid/eval-runs'],
      ['GET', '/agents/not-a-uuid/eval-runs'],
      ['GET', '/eval-runs/not-a-uuid'],
      ['GET', '/eval-runs/compare?a=x&b=y'],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode, url).toBe(422);
    }
  });
});

describe('runs: list, detail, overview, compare', () => {
  it('pages runs newest first and every response parses against its contract', async () => {
    const { app } = await setup();
    const a = store.addRun({ agentId: AGENT_ID, startedAt: new Date('2026-03-01T00:00:00Z') });
    const b = store.addRun({ agentId: AGENT_ID, startedAt: new Date('2026-03-02T00:00:00Z') });
    const c = store.addRun({ agentId: AGENT_ID, startedAt: new Date('2026-03-03T00:00:00Z') });
    const p1 = EvalRunPage.parse((await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/eval-runs?limit=2` })).json());
    expect(p1.items.map((r) => r.id)).toEqual([c.id, b.id]);
    expect(p1.next_cursor).not.toBeNull();
    const p2 = EvalRunPage.parse(
      (await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/eval-runs?limit=2&cursor=${p1.next_cursor}` })).json(),
    );
    expect(p2.items.map((r) => r.id)).toEqual([a.id]);
    expect(p2.next_cursor).toBeNull();

    expect((await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/eval-runs?limit=51` })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/eval-runs?cursor=zzz` })).statusCode).toBe(400);

    EvalSuiteRunDetail.parse((await app.inject({ method: 'GET', url: `/eval-runs/${a.id}` })).json());
    EvalOverview.parse((await app.inject({ method: 'GET', url: '/evals/overview' })).json());
    EvalCaseView.array().parse((await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/eval-cases` })).json());
  });

  it('compares two runs of one agent with the older as a, and 400s across agents', async () => {
    const { app } = await setup();
    const older = store.addRun({ agentId: AGENT_ID, startedAt: new Date('2026-03-01T00:00:00Z') });
    const newer = store.addRun({ agentId: AGENT_ID, startedAt: new Date('2026-03-05T00:00:00Z') });
    const other = store.addRun({ agentId: AGENT2_ID });
    const res = await app.inject({ method: 'GET', url: `/eval-runs/compare?a=${newer.id}&b=${older.id}` });
    expect(res.statusCode).toBe(200);
    const cmp = EvalCompare.parse(res.json());
    expect([cmp.a.id, cmp.b.id]).toEqual([older.id, newer.id]);

    const bad = await app.inject({ method: 'GET', url: `/eval-runs/compare?a=${older.id}&b=${other.id}` });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('runs_not_comparable');
  });
});
