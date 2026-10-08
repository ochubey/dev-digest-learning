/**
 * GET /pulls/:id/blast via app.inject() with a fake Db + fake AuthProvider + mocked
 * repoIntel and git, so it runs without Docker. See smart-diff-route.test.ts for the fake Db.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { BlastRadius } from '@devdigest/shared';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

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

const pr = (workspaceId = WS) => ({
  id: PR_ID,
  workspaceId,
  repoId: REPO_ID,
  base: 'main',
  headSha: 'abc',
});
const repo = { id: REPO_ID, owner: 'o', name: 'n' };

let closeApp: (() => Promise<void>) | null = null;
afterEach(async () => {
  await closeApp?.();
  closeApp = null;
});

async function get(
  rows: Rows,
  result: BlastResult,
  url = `/pulls/${PR_ID}/blast`,
  opts: { files?: string[]; llm?: unknown } = {},
) {
  const getBlastRadius = vi.fn(async () => result);
  const files = (opts.files ?? ['src/a.ts']).map((path) => ({ path, hunks: [] }));
  const git = { diff: async () => ({ files }) };
  const app = await buildApp({
    config,
    db: fakeDb(rows),
    overrides: {
      auth: fakeAuth as never,
      repoIntel: { getBlastRadius } as never,
      git: git as never,
      ...(opts.llm ? { llm: opts.llm as never } : {}),
    },
  });
  closeApp = () => app.close();
  return { res: await app.inject({ method: 'GET', url }), getBlastRadius };
}

const okRows = (): Rows =>
  new Map<unknown, unknown[]>([
    [t.pullRequests, [pr()]],
    [t.repos, [repo]],
  ]);

const empty: BlastResult = { changedSymbols: [], callers: [], impactedEndpoints: [] };

describe('GET /pulls/:id/blast', () => {
  it('404 when the PR does not exist', async () => {
    const { res } = await get(new Map(), empty);
    expect(res.statusCode).toBe(404);
  });

  it('403 when the PR belongs to another workspace', async () => {
    const { res, getBlastRadius } = await get(new Map([[t.pullRequests, [pr(OTHER_WS)]]]), empty);
    expect(res.statusCode).toBe(403);
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('422 for a non-uuid id', async () => {
    const { res } = await get(new Map(), empty, '/pulls/nope/blast');
    expect(res.statusCode).toBe(422);
  });

  it('200 maps the repo-intel result and calls it with changed files', async () => {
    const { res, getBlastRadius } = await get(okRows(), {
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [{ file: 'src/r.ts', symbol: 'handler', viaSymbol: 'foo', line: 7, rank: 1 }],
      impactedEndpoints: ['GET /x'],
      factsByFile: { 'src/r.ts': { endpoints: ['GET /x'], crons: ['daily'] } },
    });
    expect(res.statusCode).toBe(200);
    expect(getBlastRadius).toHaveBeenCalledWith(REPO_ID, ['src/a.ts']);
    const body = res.json();
    expect(body.degraded).toBe(false);
    expect(body.downstream[0]).toEqual({
      symbol: 'foo',
      callers: [{ name: 'handler', file: 'src/r.ts', line: 7 }],
      endpoints_affected: ['GET /x'],
      crons_affected: ['daily'],
    });
  });

  it('200 passes degraded + reason through', async () => {
    const { res } = await get(okRows(), { ...empty, degraded: true, reason: 'index_partial' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      degraded: true,
      reason: 'index_partial',
      changed_symbols: [],
    });
  });
});

describe('GET /pulls/:id/blast — integration guarantees', () => {
  const populated: BlastResult = {
    changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
    callers: [{ file: 'src/r.ts', symbol: 'handler', viaSymbol: 'foo', line: 7, rank: 1 }],
    impactedEndpoints: ['GET /x'],
    factsByFile: { 'src/r.ts': { endpoints: ['GET /x'], crons: [] } },
  };

  it('success: 200, body passes BlastRadius, repo-intel is called exactly once', async () => {
    const { res, getBlastRadius } = await get(okRows(), populated);
    expect(res.statusCode).toBe(200);
    expect(() => BlastRadius.parse(res.json())).not.toThrow();
    expect(getBlastRadius).toHaveBeenCalledTimes(1);
  });

  it('unknown PR: 404 with a readable error body', async () => {
    const { res, getBlastRadius } = await get(new Map(), populated);
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.message).toBe('PR not found');
    expect(typeof body.error.code).toBe('string');
    expect(getBlastRadius).not.toHaveBeenCalled();
  });

  it('degraded: 200 with degraded and reason in the body', async () => {
    const { res } = await get(okRows(), { ...empty, degraded: true, reason: 'no_data' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ degraded: true, reason: 'no_data' });
  });

  it('facade returned empty arrays: 200 with an empty map, not a 500', async () => {
    const { res } = await get(okRows(), empty);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      changed_symbols: [],
      downstream: [],
      degraded: false,
      reason: null,
    });
  });

  it('passes exactly the files of the PR diff as changedFiles', async () => {
    const files = ['src/a.ts', 'src/deep/nested/b.tsx', 'README.md'];
    const { getBlastRadius } = await get(okRows(), empty, undefined, { files });
    expect(getBlastRadius).toHaveBeenCalledWith(REPO_ID, files);
  });

  it('never touches an LLM provider', async () => {
    let touched = 0;
    const provider = new Proxy({}, { get: () => () => { touched += 1; } });
    const llm = {
      get openai() { touched += 1; return provider; },
      get anthropic() { touched += 1; return provider; },
      get openrouter() { touched += 1; return provider; },
    };
    const { res } = await get(okRows(), populated, undefined, { llm });
    expect(res.statusCode).toBe(200);
    expect(touched).toBe(0);
  });
});

describe('GET /pulls/:id/history', () => {
  async function history(rows: Rows, github: unknown) {
    const git = { diff: async () => ({ files: [{ path: 'src/a.ts', hunks: [] }] }) };
    const app = await buildApp({
      config,
      db: fakeDb(rows),
      overrides: { auth: fakeAuth as never, git: git as never, github: github as never },
    });
    closeApp = () => app.close();
    return app.inject({ method: 'GET', url: `/pulls/${PR_ID}/history` });
  }
  const merged = [
    { number: 7, title: 'Touch a', author: 'x', merged_at: '2026-02-01T00:00:00Z', files: ['src/a.ts', 'z.ts'] },
    { number: 8, title: 'Other', author: 'y', merged_at: '2026-02-02T00:00:00Z', files: ['q.ts'] },
  ];

  it('returns prior PRs overlapping the changed files', async () => {
    const listMerged = vi.fn(async () => merged);
    const res = await history(okRows(), { listMergedPullRequestsWithFiles: listMerged });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { history: { pr_number: number; files_overlap: string[] }[] };
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ pr_number: 7, files_overlap: ['src/a.ts'] });
    expect(listMerged).toHaveBeenCalledWith({ owner: 'o', name: 'n' }, expect.objectContaining({ excludeNumber: undefined }));
  });

  it('502 when GitHub cannot be read, so "could not check" is not shown as "none"', async () => {
    const res = await history(okRows(), {
      listMergedPullRequestsWithFiles: async () => {
        throw new Error('rate limited');
      },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'github_unavailable' } });
  });

  it('404 for an unknown PR and 403 for another workspace', async () => {
    expect((await history(new Map(), {})).statusCode).toBe(404);
    await cleanupApp();
    expect((await history(new Map([[t.pullRequests, [pr(OTHER_WS)]]]), {})).statusCode).toBe(403);
  });
});

async function cleanupApp() {
  await closeApp?.();
  closeApp = null;
}
