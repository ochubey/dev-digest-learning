import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () =>
  loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

let seq = 0;

d('GET /pulls/:id/smart-diff (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makePr(ws: string, files: [string, number, number][]) {
    const db = pg.handle.db;
    const name = `smart-diff-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 1,
        title: 'T',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'sha',
        additions: 0,
        deletions: 0,
        filesCount: files.length,
        status: 'needs_review',
        body: '',
      })
      .returning();
    for (const [path, additions, deletions] of files) {
      await db.insert(t.prFiles).values({ prId: pr!.id, path, additions, deletions });
    }
    return pr!;
  }

  async function makeReview(
    prId: string,
    agentId: string,
    createdAt: Date,
    fs: { file: string; line: number; dismissed?: boolean; scope?: 'in' | 'out' | 'signal' }[],
    kind: 'review' | 'summary' = 'review',
  ) {
    const db = pg.handle.db;
    const [rv] = await db
      .insert(t.reviews)
      .values({ workspaceId, prId, agentId, kind, createdAt })
      .returning();
    for (const f of fs) {
      await db.insert(t.findings).values({
        reviewId: rv!.id,
        file: f.file,
        startLine: f.line,
        endLine: f.line,
        severity: 'WARNING',
        category: 'bug',
        title: 'x',
        rationale: 'y',
        confidence: 0.5,
        dismissedAt: f.dismissed ? new Date() : null,
        scope: f.scope ?? null,
      });
    }
    return rv!;
  }

  it('200 with no reviews', async () => {
    const pr = await makePr(workspaceId, [['src/a.ts', 3, 1], ['README.md', 1, 1]]);
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const body = SmartDiff.parse(res.json());
    expect(body.groups.map((g) => g.role)).toEqual(['core', 'docs']);
    expect(body.split_suggestion.total_lines).toBe(6);
    expect(body.groups.flatMap((g) => g.files).every((f) => f.finding_lines.length === 0)).toBe(
      true,
    );
    await app.close();
  });

  it('newer review of an agent overrides older; agents are unioned; dismissed/out excluded', async () => {
    const pr = await makePr(workspaceId, [['src/a.ts', 1, 1], ['src/b.ts', 1, 1]]);
    const agentA = randomUUID();
    const agentB = randomUUID();
    await makeReview(pr.id, agentA, new Date(1000), [{ file: 'src/a.ts', line: 99 }]);
    await makeReview(pr.id, agentA, new Date(2000), [
      { file: 'src/a.ts', line: 10 },
      { file: 'src/a.ts', line: 4 },
      { file: 'src/a.ts', line: 5, dismissed: true },
      { file: 'src/a.ts', line: 6, scope: 'out' },
    ]);
    await makeReview(pr.id, agentB, new Date(500), [
      { file: 'src/a.ts', line: 10 },
      { file: 'src/b.ts', line: 2 },
    ]);
    // a summary review must not contribute
    await makeReview(pr.id, agentB, new Date(9000), [{ file: 'src/b.ts', line: 77 }], 'summary');

    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const files = SmartDiff.parse(res.json()).groups[0]!.files;
    expect(files.find((f) => f.path === 'src/a.ts')!.finding_lines).toEqual([4, 10]);
    expect(files.find((f) => f.path === 'src/b.ts')!.finding_lines).toEqual([2]);
    await app.close();
  });

  it('403 for a PR in another workspace, 404 for a missing PR', async () => {
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other' })
      .returning();
    const pr = await makePr(other!.id, [['src/a.ts', 1, 1]]);
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const forbidden = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(forbidden.statusCode).toBe(403);
    const missing = await app.inject({
      method: 'GET',
      url: `/pulls/${randomUUID()}/smart-diff`,
    });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });
});
