/**
 * GET /pulls/:id/blast via app.inject() with a fake Db + fake AuthProvider + mocked
 * repoIntel and git, so it runs without Docker. See smart-diff-route.test.ts for the fake Db.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
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

async function get(rows: Rows, result: BlastResult, url = `/pulls/${PR_ID}/blast`) {
  const getBlastRadius = vi.fn(async () => result);
  const git = { diff: async () => ({ files: [{ path: 'src/a.ts', hunks: [] }] }) };
  const app = await buildApp({
    config,
    db: fakeDb(rows),
    overrides: {
      auth: fakeAuth as never,
      repoIntel: { getBlastRadius } as never,
      git: git as never,
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
