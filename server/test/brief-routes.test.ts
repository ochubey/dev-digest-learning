/**
 * GET/POST /pulls/:id/brief via app.inject() with a fake Db (rows are looked up by the table
 * passed to `.from()`; `where` is NOT evaluated, so workspace and settings scenarios are driven
 * by row fixtures, as in intent-routes.test.ts). pr_brief persistence is emulated by spying on
 * BriefRepository; real persistence is covered by brief.it.test.ts. No Docker needed.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  diff: { current: null as unknown },
  budget: { current: undefined as number | undefined },
  logSpy: vi.fn(),
  groundOverride: { current: undefined as undefined | ((...a: never[]) => unknown) },
}));
vi.mock('../src/modules/brief/grounding.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/modules/brief/grounding.js')>();
  return {
    ...actual,
    groundBrief: (...args: Parameters<typeof actual.groundBrief>) =>
      hoisted.groundOverride.current
        ? (hoisted.groundOverride.current as (...a: unknown[]) => ReturnType<typeof actual.groundBrief>)(...args)
        : actual.groundBrief(...args),
  };
});

vi.mock('../src/modules/blast/files.js', () => ({
  changedDiffForPr: async () => hoisted.diff.current,
  changedFilesForPr: async () => [],
}));
vi.mock('../src/modules/brief/log-line.js', async (importActual) => ({
  ...(await importActual<typeof import('../src/modules/brief/log-line.js')>()),
  logBriefGeneration: hoisted.logSpy,
}));
vi.mock('../src/modules/brief/prompt.js', async (importActual) => {
  const actual = await importActual<typeof import('../src/modules/brief/prompt.js')>();
  return {
    ...actual,
    buildBriefPrompt: (input: never, opts: object = {}) =>
      actual.buildBriefPrompt(input, { ...opts, budgetTokens: hoisted.budget.current }),
  };
});

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { ExternalServiceError } from '../src/platform/errors.js';
import { BriefRepository } from '../src/modules/brief/repository.js';
import { briefLogFields } from '../src/modules/brief/log-line.js';
import { BriefResponseSchema } from '../src/modules/brief/schema.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const PR_ID = '33333333-3333-4333-8333-333333333333';
const REPO_ID = '44444444-4444-4444-8444-444444444444';
const T0 = new Date('2026-10-09T12:00:00.000Z');

type Rows = Map<unknown, unknown[]>;

function fakeDb(rows: Rows): Db {
  const chain = (table?: unknown): unknown => {
    const p: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(rows.get(table) ?? []);
          if (prop === 'from') return (tbl: unknown) => chain(tbl);
          return () => p;
        },
      },
    );
    return p;
  };
  return new Proxy({}, { get: () => () => chain() }) as unknown as Db;
}

const fakeAuth = {
  currentUser: async () => ({ id: 'u1' }),
  currentWorkspace: async () => ({ id: WS }),
};

const pr = (over: Record<string, unknown> = {}) => ({
  id: PR_ID,
  workspaceId: WS,
  repoId: REPO_ID,
  title: 'Add thing',
  body: 'Adds the thing.',
  headSha: 'sha-1',
  ...over,
});

const diffOf = (paths: string[] = ['src/a.ts']) => ({
  status: 'loaded',
  diff: {
    raw: '',
    files: paths.map((path) => ({
      path,
      additions: 3,
      deletions: 1,
      hunks: [{ file: path, oldStart: 1, oldLines: 1, newStart: 10, newLines: 5, newLineNumbers: [] }],
    })),
  },
});

const OUTPUT = {
  summary: 'It adds the thing.',
  risks: [
    {
      kind: 'correctness',
      title: 'Edge',
      explanation: 'x',
      severity: 'high',
      file_refs: ['src/a.ts', 'invented.ts'],
      anchor_file: null, anchor_start_line: null, anchor_end_line: null,
    },
  ],
  review_focus: [{ file: 'src/a.ts', line: 12, reason: 'core' }],
};

const intentRow = {
  prId: PR_ID,
  summary: 'Intent S',
  inScope: ['a'],
  outOfScope: ['b'],
  confidence: 0.8,
  sources: [{ label: 'PR title', status: 'fetched' }],
  missingContext: [],
};

const storedBrief = (sha = 'sha-1') => ({
  summary: 'Old summary',
  intent: null,
  blast: null,
  risks: { risks: [] },
  review_focus: [],
  meta: {
    generated_from_head_sha: sha,
    generated_at: '2026-10-01T00:00:00.000Z',
    provider: 'openai',
    model: 'gpt-4.1',
    schema_attempts: 1,
    tokens_in: 10,
    tokens_out: 5,
    cost_usd: null,
    missing: [],
    sources: [],
    diff_stats: null,
    input: { estimated_tokens: 100, budget_tokens: 8000, truncated: [], blast_degraded_reason: null },
    grounding: { dropped_risks: 0, dropped_refs: 0, dropped_focus: 0, adjusted_lines: 0 },
  },
});

let closeApp: (() => Promise<void>) | null = null;
let store: Map<string, unknown>;
let upserts: unknown[][];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  hoisted.diff.current = diffOf();
  hoisted.budget.current = undefined;
  hoisted.groundOverride.current = undefined;
  hoisted.logSpy.mockClear();
  store = new Map();
  upserts = [];
  vi.spyOn(BriefRepository.prototype, 'getBrief').mockImplementation(async (id: string) => store.get(id));
  vi.spyOn(BriefRepository.prototype, 'upsertBrief').mockImplementation(async (id: string, json: unknown) => {
    upserts.push([id, json]);
    store.set(id, json);
  });
});

afterEach(async () => {
  await closeApp?.();
  closeApp = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup(
  over: {
    rows?: [unknown, unknown[]][];
    llm?: MockLLMProvider;
    github?: MockGitHubClient;
    blast?: () => Promise<unknown>;
    secrets?: { get: (k: string) => Promise<string | undefined> };
    llmMap?: 'all' | 'openai-only';
  } = {},
) {
  const rows: Rows = new Map<unknown, unknown[]>([
    [t.pullRequests, [pr()]],
    [t.repos, [{ id: REPO_ID, owner: 'o', name: 'r' }]],
    [t.prIntent, [intentRow]],
    ...(over.rows ?? []),
  ]);
  const llm = over.llm ?? new MockLLMProvider('openai', { structured: OUTPUT });
  const github = over.github ?? new MockGitHubClient();
  const getBlastRadius = vi.fn(
    over.blast ??
      (async () => ({
        changedSymbols: [{ file: 'src/a.ts', name: 'doThing', kind: 'function' }],
        callers: [{ file: 'src/caller.ts', symbol: 'run', viaSymbol: 'doThing', line: 4, rank: 1 }],
        impactedEndpoints: [],
      })),
  );
  const app = await buildApp({
    config,
    db: fakeDb(rows),
    overrides: {
      auth: fakeAuth as never,
      github,
      repoIntel: { getBlastRadius } as never,
      ...(over.secrets ? { secrets: over.secrets as never } : {}),
      llm: over.llmMap === 'openai-only' ? { openai: llm } : { openai: llm, anthropic: llm, openrouter: llm },
    },
  });
  closeApp = () => app.close();
  const structuredCalls = () => llm.calls.filter((c) => c.method === 'completeStructured');
  return {
    app,
    rows,
    llm,
    github,
    getBlastRadius,
    structuredCalls,
    get: () => app.inject({ method: 'GET', url: `/pulls/${PR_ID}/brief` }),
    post: () => app.inject({ method: 'POST', url: `/pulls/${PR_ID}/brief` }),
  };
}

const lastLog = () => hoisted.logSpy.mock.calls.at(-1)?.[1] as Parameters<typeof briefLogFields>[0];

describe('GET /pulls/:id/brief', () => {
  it('404 when there is no PR, and when there is no row', async () => {
    const a = await setup({ rows: [[t.pullRequests, []]] });
    expect((await a.get()).statusCode).toBe(404);
    await closeApp?.();
    const b = await setup();
    expect((await b.get()).statusCode).toBe(404);
  });

  it('403 for a PR in another workspace even with a brief seeded; no brief fields in the body', async () => {
    store.set(PR_ID, storedBrief());
    const s = await setup({ rows: [[t.pullRequests, [pr({ workspaceId: OTHER_WS })]]] });
    const res = await s.get();
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body).toHaveProperty('error');
    expect(body).not.toHaveProperty('summary');
    expect(JSON.stringify(body)).not.toContain('Old summary');
  });

  it('404 plus a warning when the stored JSON does not parse', async () => {
    store.set(PR_ID, { summary: 42 });
    const s = await setup();
    const warn = vi.spyOn(s.app.log, 'warn');
    expect((await s.get()).statusCode).toBe(404);
    expect(warn).toHaveBeenCalled();
  });

  it('200 with zero LLM, GitHub and diff calls; stale false while the head SHA matches', async () => {
    store.set(PR_ID, storedBrief('sha-1'));
    const s = await setup();
    const ghCalls = vi.spyOn(s.github, 'getIssue');
    const res = await s.get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(BriefResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ pr_id: PR_ID, stale: false, summary: 'Old summary' });
    expect(s.llm.calls).toHaveLength(0);
    expect(ghCalls).not.toHaveBeenCalled();
    expect(s.getBlastRadius).not.toHaveBeenCalled();
  });

  it('stale true once the PR head_sha changed', async () => {
    store.set(PR_ID, storedBrief('sha-1'));
    const s = await setup({ rows: [[t.pullRequests, [pr({ headSha: 'sha-2' })]]] });
    expect((await s.get()).json().stale).toBe(true);
  });
});

const anchored = (title: string, a: [string | null, number | null, number | null]) => ({
  kind: 'correctness',
  title,
  explanation: 'x',
  severity: 'high',
  file_refs: ['src/a.ts'],
  anchor_file: a[0],
  anchor_start_line: a[1],
  anchor_end_line: a[2],
});

describe('rev 4 risk anchors', () => {
  it('POST: logged grounding.dropped_anchors equals the counted drops; clipped anchor is stored', async () => {
    const llm = new MockLLMProvider('openai', {
      structured: {
        summary: 's',
        risks: [
          anchored('ok', ['src/a.ts', 12, 30]),
          anchored('outside', ['src/a.ts', 40, 50]),
          anchored('partial', ['src/a.ts', 12, null]),
        ],
        review_focus: [],
      },
    });
    const s = await setup({ llm });
    const res = await s.post();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.grounding.dropped_anchors).toBe(2);
    expect(body.risks.risks[0].anchor).toEqual({ file: 'src/a.ts', start_line: 12, end_line: 14 });
    expect(body.risks.risks[1].anchor).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('anchor_');
    expect(briefLogFields(lastLog()).grounding).toMatchObject({ dropped_anchors: 2 });
  });

  it('POST with an unavailable diff: no stored or returned risk has an anchor', async () => {
    hoisted.diff.current = { status: 'unavailable', reason: 'no_pr_files' };
    const llm = new MockLLMProvider('openai', {
      structured: {
        summary: 's',
        risks: [{ ...anchored('caller', ['src/caller.ts', 3, 5]), file_refs: ['src/caller.ts'] }],
        review_focus: [],
      },
    });
    const s = await setup({ llm });
    const res = await s.post();
    expect(res.statusCode).toBe(200);
    const returned = res.json().risks.risks as { anchor?: unknown }[];
    for (const r of returned) expect(r.anchor).toBeUndefined();
    const stored = (upserts.at(-1)![1] as { risks: { risks: { anchor?: unknown }[] } }).risks.risks;
    for (const r of stored) expect(r.anchor).toBeUndefined();
  });

  it('GET of a pre-revision row (no anchor, no dropped_anchors) is 200 with dropped_anchors 0', async () => {
    const old = storedBrief('sha-1');
    old.risks = {
      risks: [
        { kind: 'other', title: 't', explanation: 'e', severity: 'low', file_refs: ['src/a.ts'] },
      ],
    } as never;
    store.set(PR_ID, old);
    const s = await setup();
    const res = await s.get();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(BriefResponseSchema.safeParse(body).success).toBe(true);
    expect(body.meta.grounding.dropped_anchors).toBe(0);
    expect(body.risks.risks[0].anchor).toBeUndefined();
  });
});

describe('POST /pulls/:id/brief', () => {
  it('404 with zero GitHub, DB-write and LLM calls when the PR does not exist', async () => {
    const s = await setup({ rows: [[t.pullRequests, []]] });
    const gh = vi.spyOn(s.github, 'getIssue');
    expect((await s.post()).statusCode).toBe(404);
    expect(gh).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
    expect(s.llm.calls).toHaveLength(0);
    expect(hoisted.logSpy).not.toHaveBeenCalled();
  });

  it('403 for another workspace with no side effects; the limiter is untouched (a member is admitted next)', async () => {
    const s = await setup({ rows: [[t.pullRequests, [pr({ workspaceId: OTHER_WS })]]] });
    const gh = vi.spyOn(s.github, 'getIssue');
    expect((await s.post()).statusCode).toBe(403);
    expect(gh).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
    expect(s.llm.calls).toHaveLength(0);
    s.rows.set(t.pullRequests, [pr()]);
    const ok = await s.post();
    expect(ok.statusCode).toBe(200);
  });

  it('200 success: one log line brief=1 ok with schema_attempts 1 and the grounding counts', async () => {
    const s = await setup();
    const res = await s.post();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(BriefResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ pr_id: PR_ID, stale: false });
    expect(body.meta.grounding).toEqual({
      dropped_risks: 0,
      dropped_refs: 1,
      dropped_focus: 0,
      adjusted_lines: 0,
      dropped_anchors: 0,
    });
    expect(s.structuredCalls()).toHaveLength(1);
    expect(upserts).toHaveLength(1);

    expect(hoisted.logSpy).toHaveBeenCalledTimes(1);
    const fields = briefLogFields(lastLog());
    expect(fields.calls).toBe('brief=1 ok');
    expect(fields.schema_attempts).toBe(1);
    expect(fields.grounding).toEqual(body.meta.grounding);
  });

  it('a second request within 30 s is 429 with Retry-After and {error, retry_after}; no extra calls', async () => {
    const s = await setup();
    expect((await s.post()).statusCode).toBe(200);
    vi.setSystemTime(T0.getTime() + 10_000);
    const res = await s.post();
    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ retry_after: 20 });
    expect(typeof res.json().error).toBe('string');
    expect(res.headers['retry-after']).toBe('20');
    expect(s.structuredCalls()).toHaveLength(1);
    expect(upserts).toHaveLength(1);
  });

  it('two concurrent POSTs for the same PR: exactly one LLM call and one 429', async () => {
    const s = await setup();
    const [a, b] = await Promise.all([s.post(), s.post()]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 429]);
    expect(s.structuredCalls()).toHaveLength(1);
    expect(upserts).toHaveLength(1);
  });

  describe('a generation that outlives the cooldown', () => {
    function pendingLlm() {
      const llm = new MockLLMProvider('openai', { structured: OUTPUT });
      const orig = llm.completeStructured.bind(llm);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let n = 0;
      vi.spyOn(llm, 'completeStructured').mockImplementation(async (req) => {
        n++;
        if (n === 1) await gate;
        return orig(req);
      });
      return { llm, release, started: () => n };
    }

    it('a POST after the cooldown window while the first is still pending is 429 (retry_after >= 1); after completion a later POST is admitted', async () => {
      const { llm, release, started } = pendingLlm();
      const s = await setup({ llm });
      const first = s.post();
      await vi.waitFor(() => expect(started()).toBe(1));

      vi.setSystemTime(T0.getTime() + 40_000);
      const second = await s.post();
      expect(second.statusCode).toBe(429);
      expect(second.json().retry_after).toBeGreaterThanOrEqual(1);
      expect(second.headers['retry-after']).toBe(String(second.json().retry_after));
      expect(started()).toBe(1);

      release();
      expect((await first).statusCode).toBe(200);
      expect(upserts).toHaveLength(1);

      // Released in finally: once the cooldown has also passed, a new POST is admitted.
      vi.setSystemTime(T0.getTime() + 80_000);
      expect((await s.post()).statusCode).toBe(200);
      expect(s.structuredCalls()).toHaveLength(2);
    });

    it('the in-flight slot is released when generation fails', async () => {
      const llm = new MockLLMProvider('openai', {});
      const spy = vi.spyOn(llm, 'completeStructured').mockRejectedValue(new Error('down'));
      const s = await setup({ llm });
      expect((await s.post()).statusCode).toBe(502);
      vi.setSystemTime(T0.getTime() + 31_000);
      expect((await s.post()).statusCode).toBe(502);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  it('retry_after rounds up and is at least 1 (29.2 s left -> 30, 0.1 s left -> 1)', async () => {
    const s = await setup();
    await s.post();
    vi.setSystemTime(T0.getTime() + 800);
    const a = await s.post();
    expect(a.json().retry_after).toBe(30);
    expect(a.headers['retry-after']).toBe('30');
    vi.setSystemTime(T0.getTime() + 29_900);
    const b = await s.post();
    expect(b.json().retry_after).toBe(1);
    expect(b.headers['retry-after']).toBe('1');
  });

  it('after the window a new POST calls the LLM again and replaces the brief', async () => {
    const s = await setup();
    await s.post();
    const first = store.get(PR_ID);
    vi.setSystemTime(T0.getTime() + 30_000);
    expect((await s.post()).statusCode).toBe(200);
    expect(s.structuredCalls()).toHaveLength(2);
    expect(upserts).toHaveLength(2);
    expect(store.get(PR_ID)).not.toBe(first);
    expect((store.get(PR_ID) as { meta: { generated_at: string } }).meta.generated_at).toBe(
      '2026-10-09T12:00:30.000Z',
    );
  });

  it('a failed (provider_unavailable) POST still counts: the next POST is 429', async () => {
    const s = await setup({
      rows: [[t.settings, [{ key: 'feature_models', value: { risk_brief: { provider: 'anthropic', model: 'c' } } }]]],
      llmMap: 'openai-only',
      secrets: { get: async () => undefined },
    });
    expect((await s.post()).statusCode).toBe(502);
    vi.setSystemTime(T0.getTime() + 1000);
    expect((await s.post()).statusCode).toBe(429);
  });

  it('a workspace risk_brief override picks the model and is recorded in meta', async () => {
    const s = await setup({
      rows: [[t.settings, [{ key: 'feature_models', value: { risk_brief: { provider: 'anthropic', model: 'claude-x' } } }]]],
    });
    const res = await s.post();
    expect(res.statusCode).toBe(200);
    expect(s.structuredCalls()[0]!.req).toMatchObject({ model: 'claude-x' });
    expect(res.json().meta).toMatchObject({ provider: 'anthropic', model: 'claude-x' });
  });

  it('no key for the configured provider: 502 naming the Risk Brief setting, no calls, row unchanged, provider_unavailable', async () => {
    store.set(PR_ID, storedBrief());
    const before = store.get(PR_ID);
    const s = await setup({
      rows: [[t.settings, [{ key: 'feature_models', value: { risk_brief: { provider: 'anthropic', model: 'c' } } }]]],
      llmMap: 'openai-only',
      secrets: { get: async () => undefined },
    });
    const res = await s.post();
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('Settings > Models > Risk Brief');
    expect(typeof res.json().retry_after).toBe('number');
    expect(s.llm.calls).toHaveLength(0);
    expect(store.get(PR_ID)).toBe(before);
    expect(upserts).toHaveLength(0);
    expect(briefLogFields(lastLog()).calls).toBe('brief=0 provider_unavailable');
  });

  it('LLM throws: 502 {error, retry_after}, nothing stored, log brief=1 provider_error', async () => {
    const llm = new MockLLMProvider('openai', {});
    vi.spyOn(llm, 'completeStructured').mockRejectedValue(new Error('upstream down'));
    const s = await setup({ llm });
    const res = await s.post();
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ retry_after: 30 });
    expect(typeof res.json().error).toBe('string');
    expect(upserts).toHaveLength(0);
    expect(briefLogFields(lastLog()).calls).toBe('brief=1 provider_error');
    expect(hoisted.logSpy).toHaveBeenCalledTimes(1);
  });

  it('upsertBrief rejects: 502 with the store text, one log line, cooldown released (AC-26)', async () => {
    vi.spyOn(BriefRepository.prototype, 'upsertBrief').mockRejectedValue(new Error('SQLITE_BUSY'));
    const s = await setup();
    const res = await s.post();
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'The brief could not be stored', retry_after: 30 });
    expect(store.size).toBe(0);
    expect(hoisted.logSpy).toHaveBeenCalledTimes(1);
    expect(briefLogFields(lastLog()).calls).toBe('brief=1 provider_error');

    // Within the window it counts (429); once it has passed, the PR is admitted again.
    expect((await s.post()).statusCode).toBe(429);
    vi.setSystemTime(T0.getTime() + 31_000);
    expect((await s.post()).statusCode).toBe(502);
  });

  it('a schema-validation ExternalServiceError: 502, row unchanged, log brief=1 invalid_output', async () => {
    store.set(PR_ID, storedBrief());
    const before = store.get(PR_ID);
    const llm = new MockLLMProvider('openai', {});
    vi.spyOn(llm, 'completeStructured').mockRejectedValue(
      new ExternalServiceError('OpenAI structured output failed schema validation', { raw: 'x' }),
    );
    const s = await setup({ llm });
    const res = await s.post();
    expect(res.statusCode).toBe(502);
    expect(store.get(PR_ID)).toBe(before);
    expect(briefLogFields(lastLog()).calls).toBe('brief=1 invalid_output');
  });

  it('post-grounding validation failure: 502, row unchanged, one log line brief=1 invalid_output', async () => {
    store.set(PR_ID, storedBrief());
    const before = store.get(PR_ID);
    // Route builds BriefService with only a cooldown, so the seam is the grounding module:
    // a risk left with no file_refs passes the model schema but fails PrBriefStored.
    hoisted.groundOverride.current = () => ({
      risks: [{ kind: 'other', title: 't', explanation: 'e', severity: 'low', file_refs: [] }],
      review_focus: [],
      counts: { dropped_risks: 0, dropped_refs: 0, dropped_focus: 0, adjusted_lines: 0, dropped_anchors: 0 },
    });
    const s = await setup();
    const res = await s.post();
    expect(res.statusCode).toBe(502);
    expect(s.structuredCalls()).toHaveLength(1);
    expect(upserts).toHaveLength(0);
    expect(store.get(PR_ID)).toBe(before);
    expect(hoisted.logSpy).toHaveBeenCalledTimes(1);
    expect(briefLogFields(lastLog()).calls).toBe('brief=1 invalid_output');
  });

  it('error text with a prompt sentinel and a key never reaches the log fields or the 502 body', async () => {
    const llm = new MockLLMProvider('openai', {});
    vi.spyOn(llm, 'completeStructured').mockRejectedValue(
      Object.assign(new Error('bad request: PROMPT-SENTINEL-42 key sk-test-123'), {
        status: 400,
        details: { raw: 'PROMPT-SENTINEL-42' },
      }),
    );
    const s = await setup({ llm, rows: [[t.pullRequests, [pr({ body: 'PROMPT-SENTINEL-42' })]]] });
    const res = await s.post();
    expect(res.statusCode).toBe(502);
    const logged = JSON.stringify(briefLogFields(lastLog()));
    for (const text of [res.body, logged]) {
      expect(text).not.toContain('PROMPT-SENTINEL-42');
      expect(text).not.toContain('sk-test-123');
    }
  });

  it('protected content over a reduced budget: 502, zero LLM calls, row unchanged, brief=0 input_over_budget', async () => {
    store.set(PR_ID, storedBrief());
    const before = store.get(PR_ID);
    hoisted.budget.current = 50;
    const s = await setup({
      rows: [[t.prIntent, [{ ...intentRow, summary: 'long intent '.repeat(100) }]]],
    });
    const res = await s.post();
    expect(res.statusCode).toBe(502);
    expect(s.llm.calls).toHaveLength(0);
    expect(store.get(PR_ID)).toBe(before);
    expect(briefLogFields(lastLog()).calls).toBe('brief=0 input_over_budget');
  });

  it('timeout: 502 and log brief=1 timeout', async () => {
    const llm = new MockLLMProvider('openai', {});
    const { TimeoutError } = await import('../src/platform/resilience.js');
    vi.spyOn(llm, 'completeStructured').mockRejectedValue(new TimeoutError(50_000));
    const s = await setup({ llm });
    expect((await s.post()).statusCode).toBe(502);
    expect(briefLogFields(lastLog()).calls).toBe('brief=1 timeout');
    expect(upserts).toHaveLength(0);
  });

  it('a head_sha change during generation: stale true, stored SHA is the pre-generation one', async () => {
    const llm = new MockLLMProvider('openai', { structured: OUTPUT });
    const orig = llm.completeStructured.bind(llm);
    let rowsRef: Rows | undefined;
    vi.spyOn(llm, 'completeStructured').mockImplementation(async (req) => {
      rowsRef!.set(t.pullRequests, [pr({ headSha: 'sha-2' })]);
      return orig(req);
    });
    const s = await setup({ llm });
    rowsRef = s.rows;
    const res = await s.post();
    expect(res.statusCode).toBe(200);
    expect(res.json().stale).toBe(true);
    expect(res.json().meta.generated_from_head_sha).toBe('sha-1');
    expect((store.get(PR_ID) as { meta: { generated_from_head_sha: string } }).meta.generated_from_head_sha).toBe('sha-1');
  });

  it('degraded blast, no intent, unavailable diff: 200 with canonical missing', async () => {
    hoisted.diff.current = { status: 'unavailable', reason: 'no_pr_files' };
    const s = await setup({
      rows: [[t.prIntent, []]],
      blast: async () => ({ changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true, reason: 'no_index' }),
    });
    const res = await s.post();
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.missing).toEqual(['intent', 'blast', 'linked_issue', 'specs', 'diff']);
    expect(res.json().intent).toBeNull();
    expect(res.json().blast).toBeNull();
  });

  it('a loaded diff with 0 files: diff is not missing and review_focus is []', async () => {
    hoisted.diff.current = { status: 'loaded', diff: { raw: '', files: [] } };
    const s = await setup();
    const res = await s.post();
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.missing).not.toContain('diff');
    expect(res.json().meta.diff_stats.files).toBe(0);
    expect(res.json().review_focus).toEqual([]);
  });
});
