/**
 * GET /pulls/:id/smart-diff via app.inject() with a fake Db + fake AuthProvider,
 * so it runs without Docker. The fake Db is a thenable query-builder that
 * resolves to the rows registered for the table passed to `.from()`; `where`
 * filters are not evaluated (each test seeds exactly the rows it needs).
 * Real-SQL behaviour is covered in smart-diff.it.test.ts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import * as t from '../src/db/schema.js';
import { SmartDiff } from '@devdigest/shared';

const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
} as NodeJS.ProcessEnv);

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const PR_ID = '33333333-3333-4333-8333-333333333333';

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

const pr = (workspaceId = WS) => ({ id: PR_ID, workspaceId, headSha: 'abc' });
const file = (path: string, additions: number, deletions: number) => ({
  id: path,
  prId: PR_ID,
  path,
  additions,
  deletions,
  patch: null,
});
const review = (id: string, agentId: string, createdAt: number) => ({
  id,
  prId: PR_ID,
  agentId,
  kind: 'review',
  createdAt: new Date(createdAt),
});
const finding = (reviewId: string, fileName: string, startLine: number, extra = {}) => ({
  id: `${reviewId}-${fileName}-${startLine}`,
  reviewId,
  file: fileName,
  startLine,
  dismissedAt: null,
  scope: null,
  ...extra,
});

let closeApp: (() => Promise<void>) | null = null;
afterEach(async () => {
  await closeApp?.();
  closeApp = null;
});

async function get(rows: Rows, url = `/pulls/${PR_ID}/smart-diff`) {
  const app = await buildApp({ config, db: fakeDb(rows), overrides: { auth: fakeAuth as never } });
  closeApp = () => app.close();
  return app.inject({ method: 'GET', url });
}

describe('GET /pulls/:id/smart-diff', () => {
  it('404 when the PR does not exist', async () => {
    const res = await get(new Map());
    expect(res.statusCode).toBe(404);
  });

  it('403 when the PR belongs to another workspace', async () => {
    const res = await get(new Map([[t.pullRequests, [pr(OTHER_WS)]]]));
    expect(res.statusCode).toBe(403);
  });

  it('422 for a non-uuid id', async () => {
    const res = await get(new Map(), '/pulls/nope/smart-diff');
    expect(res.statusCode).toBe(422);
  });

  it('200 with no reviews: groups ordered, finding_lines empty, totals summed', async () => {
    const res = await get(
      new Map<unknown, unknown[]>([
        [t.pullRequests, [pr()]],
        [
          t.prFiles,
          [file('README.md', 2, 1), file('src/b.ts', 10, 0), file('src/a.ts', 5, 5)],
        ],
      ]),
    );
    expect(res.statusCode).toBe(200);
    const body = SmartDiff.parse(res.json());
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'docs']);
    expect(body.groups[0]!.files.map((x) => x.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(body.groups.flatMap((g) => g.files).every((x) => x.finding_lines.length === 0)).toBe(
      true,
    );
    expect(body.split_suggestion).toEqual({ too_big: false, total_lines: 23, proposed_splits: [] });
  });

  it('200 with reviews: latest per agent, dismissed and scope out excluded', async () => {
    const res = await get(
      new Map<unknown, unknown[]>([
        [t.pullRequests, [pr()]],
        [t.prFiles, [file('src/a.ts', 1, 1)]],
        [t.reviews, [review('new', 'A', 2000), review('old', 'A', 1000)]],
        [
          t.findings,
          [
            finding('new', 'src/a.ts', 20),
            finding('new', 'src/a.ts', 7),
            finding('new', 'src/a.ts', 7),
            finding('new', 'src/a.ts', 8, { dismissedAt: new Date() }),
            finding('new', 'src/a.ts', 9, { scope: 'out' }),
            finding('old', 'src/a.ts', 99),
          ],
        ],
      ]),
    );
    expect(res.statusCode).toBe(200);
    const body = SmartDiff.parse(res.json());
    expect(body.groups[0]!.files[0]!.finding_lines).toEqual([7, 20]);
  });
});
