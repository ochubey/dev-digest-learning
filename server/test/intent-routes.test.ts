/**
 * GET /pulls/:id/intent and POST /pulls/:id/intent/derive via app.inject() with a fake Db
 * (same thenable query-builder trick as smart-diff-route.test.ts: rows are looked up by the
 * table passed to `.from()`, `where` is not evaluated; `rows.get(undefined)` is what
 * insert()/update() chains resolve to) and mock GitHub/LLM adapters. No Docker needed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { computeCacheKeyHash } from '../src/modules/intent/service.js';

const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
} as NodeJS.ProcessEnv);

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const PR_ID = '33333333-3333-4333-8333-333333333333';
const REPO_ID = '44444444-4444-4444-8444-444444444444';

type Rows = Map<unknown, unknown[]>;

function fakeDb(rows: Rows): Db {
  const chain = (table?: unknown): unknown => {
    const p: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve(rows.get(table) ?? []);
          }
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
  headSha: 'abc',
  ...over,
});

const intentRow = (over: Record<string, unknown> = {}) => ({
  prId: PR_ID,
  summary: 'S',
  inScope: ['a'],
  outOfScope: ['b'],
  confidence: 0.8,
  sources: [{ label: 'PR title', status: 'fetched' }],
  missingContext: [],
  derivedFromHeadSha: 'abc',
  cacheKeyHash: computeCacheKeyHash('Add thing', 'Adds the thing.'),
  model: 'openrouter/flash',
  costUsd: 0.001,
  updatedAt: new Date('2026-10-03T12:00:00Z'),
  ...over,
});

const LLM_FIXTURE = {
  summary: 'S2',
  in_scope: ['a'],
  out_of_scope: [],
  confidence: 0.9,
  sources: [],
  missing_context: [],
};

let closeApp: (() => Promise<void>) | null = null;
let now = 1_000_000;
afterEach(async () => {
  await closeApp?.();
  closeApp = null;
  vi.restoreAllMocks();
});

async function setup(extra: [unknown, unknown[]][] = [], opts: { llmThrows?: boolean; git?: MockGitClient } = {}) {
  now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const rows: Rows = new Map<unknown, unknown[]>([
    [t.pullRequests, [pr()]],
    [t.repos, [{ id: REPO_ID, owner: 'o', name: 'r' }]],
    [t.prFiles, [{ id: 'f1', prId: PR_ID, path: 'src/a.ts', patch: '@@ -1 +1 @@\n+x' }]],
    ...extra,
  ]);
  // insert()/update() chains resolve to rows.get(undefined): the "saved" row
  if (!rows.has(undefined)) rows.set(undefined, rows.get(t.prIntent) ?? [intentRow()]);
  const llm = new MockLLMProvider('openai', { structured: LLM_FIXTURE });
  if (opts.llmThrows) {
    vi.spyOn(llm, 'completeStructured').mockRejectedValue(new Error('upstream down'));
  }
  const app = await buildApp({
    config,
    db: fakeDb(rows),
    overrides: {
      auth: fakeAuth as never,
      github: new MockGitHubClient(),
      ...(opts.git ? { git: opts.git } : {}),
      llm: { openai: llm, anthropic: llm, openrouter: llm },
    },
  });
  closeApp = () => app.close();
  const userPrompt = () => {
    const call = llm.calls.find((c) => c.method === 'completeStructured');
    const msgs = (call?.req as { messages: { role: string; content: string }[] }).messages;
    return msgs.find((m) => m.role === 'user')!.content;
  };
  const structuredCalls = () => llm.calls.filter((c) => c.method === 'completeStructured').length;
  return {
    app,
    structuredCalls,
    userPrompt,
    get: (url = `/pulls/${PR_ID}/intent`) => app.inject({ method: 'GET', url }),
    derive: (payload: unknown = {}, url = `/pulls/${PR_ID}/intent/derive`) =>
      app.inject({ method: 'POST', url, payload: payload as object }),
  };
}

describe('GET /pulls/:id/intent', () => {
  it('404 when the PR does not exist', async () => {
    const s = await setup([[t.pullRequests, []]]);
    expect((await s.get()).statusCode).toBe(404);
  });

  it('404 when intent was never derived', async () => {
    const s = await setup([[t.prIntent, []]]);
    const res = await s.get();
    expect(res.statusCode).toBe(404);
  });

  it('403 for another workspace', async () => {
    const s = await setup([[t.pullRequests, [pr({ workspaceId: OTHER_WS })]]]);
    expect((await s.get()).statusCode).toBe(403);
  });

  it('200 with stale=true when the head SHA moved on', async () => {
    const s = await setup([[t.prIntent, [intentRow({ derivedFromHeadSha: 'old' })]]]);
    const res = await s.get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      pr_id: PR_ID,
      summary: 'S',
      stale: true,
      derived_from_head_sha: 'old',
      cost_usd: 0.001,
    });
  });

  it('stale=false when the SHA matches; cost 0 is reported as 0, not null', async () => {
    const s = await setup([[t.prIntent, [intentRow({ costUsd: 0 })]]]);
    const body = (await s.get()).json();
    expect(body.stale).toBe(false);
    expect(body.cost_usd).toBe(0);
  });

  it('cost_usd is null only when it was never stored', async () => {
    const s = await setup([[t.prIntent, [intentRow({ costUsd: null })]]]);
    expect((await s.get()).json().cost_usd).toBeNull();
  });
});

describe('POST /pulls/:id/intent/derive', () => {
  it('404 for an unknown PR, 403 for another workspace', async () => {
    const a = await setup([[t.pullRequests, []]]);
    expect((await a.derive()).statusCode).toBe(404);
    await closeApp?.();
    const b = await setup([[t.pullRequests, [pr({ workspaceId: OTHER_WS })]]]);
    expect((await b.derive()).statusCode).toBe(403);
  });

  it('200 derives via the LLM when there is no cache', async () => {
    const s = await setup([[t.prIntent, [intentRow({ cacheKeyHash: 'stale-hash' })]]]);
    const res = await s.derive();
    expect(res.statusCode).toBe(200);
    expect(s.structuredCalls()).toBe(1);
  });

  it('empty pr_files + a diff available: the intent prompt still lists the changed files + hunk headers', async () => {
    // pr_files is only filled lazily on PR-detail open; the derive route must use the same
    // diff the review run loads (container.git.diff), not that table.
    const git = new MockGitClient({
      diff: [
        'diff --git a/src/one.ts b/src/one.ts',
        '--- a/src/one.ts',
        '+++ b/src/one.ts',
        '@@ -1,2 +1,3 @@',
        ' a',
        '+b',
        'diff --git a/src/two.ts b/src/two.ts',
        '--- a/src/two.ts',
        '+++ b/src/two.ts',
        '@@ -4 +4 @@',
        '-c',
        '+d',
      ].join('\n'),
    });
    const s = await setup(
      [
        [t.prFiles, []],
        [t.prIntent, [intentRow({ cacheKeyHash: 'stale-hash' })]],
      ],
      { git },
    );
    const res = await s.derive();
    expect(res.statusCode).toBe(200);
    const prompt = s.userPrompt();
    expect(prompt).toContain('src/one.ts');
    expect(prompt).toContain('src/two.ts');
    expect(prompt).toContain('@@ -1,2 +1,3 @@');
  });

  it('serves the cache (no LLM call) when SHA + metadata hash match', async () => {
    const s = await setup([[t.prIntent, [intentRow()]]]);
    const res = await s.derive();
    expect(res.statusCode).toBe(200);
    expect(s.structuredCalls()).toBe(0);
  });

  it('force bypasses the cache (body)', async () => {
    const s = await setup([[t.prIntent, [intentRow()]]]);
    const res = await s.derive({ force: true });
    expect(res.statusCode).toBe(200);
    expect(s.structuredCalls()).toBe(1);
  });

  it('force bypasses the cache (query) but is still rate limited', async () => {
    const s = await setup([[t.prIntent, [intentRow()]]]);
    const first = await s.derive({}, `/pulls/${PR_ID}/intent/derive?force=true`);
    expect(first.statusCode).toBe(200);
    expect(s.structuredCalls()).toBe(1);
    const second = await s.derive({ force: true });
    expect(second.statusCode).toBe(429);
    expect(s.structuredCalls()).toBe(1);
  });

  it('429 with {error, retry_after} (+ Retry-After header) within 30s; allowed again after', async () => {
    const s = await setup([[t.prIntent, [intentRow()]]]);
    expect((await s.derive()).statusCode).toBe(200);
    now += 10_000;
    const limited = await s.derive();
    expect(limited.statusCode).toBe(429);
    const body = limited.json();
    expect(typeof body.error).toBe('string');
    expect(body.retry_after).toBe(20);
    expect(limited.headers['retry-after']).toBe('20');
    now += 20_001;
    expect((await s.derive()).statusCode).toBe(200);
  });

  it('502 body carries {error, retry_after} when derivation fails; failures count towards the limit', async () => {
    const s = await setup([[t.prIntent, [intentRow({ cacheKeyHash: 'stale-hash' })]]], {
      llmThrows: true,
    });
    const res = await s.derive();
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(typeof body.error).toBe('string');
    expect(body.retry_after).toBe(30);
    now += 5_000;
    const again = await s.derive();
    expect(again.statusCode).toBe(429);
    expect(again.json().retry_after).toBe(25);
  });
});
