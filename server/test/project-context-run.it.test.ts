import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient, MockProjectDocsSource } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { RunTrace } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  x: 1,
   redisUrl: x,`;
const REVIEW = { verdict: 'comment', summary: 'ok', score: 90, findings: [] };
const ORIGINAL = 'ORIGINAL security baseline text';

d('project context run-time (Testcontainers pg)', () => {
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

  async function runWith(contextPaths: string[], source: MockProjectDocsSource) {
    const db = pg.handle.db;
    const app = await buildApp({
      config: config(),
      db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        projectDocs: source,
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW }) },
      },
    });
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: `pc-${Math.random().toString(36).slice(2, 8)}`, fullName: `acme/pc-${Math.random()}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId, repoId: repo!.id, number: 1, title: 'T', author: 'a', branch: 'f', base: 'main',
        headSha: 'abc', additions: 1, deletions: 0, filesCount: 1, status: 'needs_review',
      })
      .returning();
    await db.insert(t.prFiles).values({ prId: pr!.id, path: 'src/config.ts', additions: 1, deletions: 0, patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  x: 1,\n   redisUrl: x,' });
    const agent = (
      await app.inject({ method: 'POST', url: '/agents', payload: { name: 'PC', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' } })
    ).json();
    // Written straight to the DB, bypassing API validation (what a corrupted/old row looks like).
    await db.update(t.agents).set({ contextPaths }).where(eq(t.agents.id, agent.id));
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/review`, payload: { agentId: agent.id } });
    const runId = res.json().runs[0].run_id as string;
    await waitForPrRuns(db, pr!.id, { expected: 1 });
    const getTrace = async () => RunTrace.parse((await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json());
    return { app, getTrace, runId };
  }

  it('trace text unchanged after stubbed main changes', async () => {
    const source = new MockProjectDocsSource({
      heads: { main: 'sha-1' },
      files: { 'sha-1': { 'specs/sec.md': ORIGINAL }, 'sha-2': { 'specs/sec.md': 'CHANGED text' } },
    });
    const { app, getTrace } = await runWith(['specs/sec.md'], source);
    const before = await getTrace();
    expect(before.project_context).toMatchObject({ commit_sha: 'sha-1' });
    const block = before.prompt_assembly.project_context_blocks?.[0];
    expect(block?.path).toBe('specs/sec.md');
    expect(block?.text).toContain(ORIGINAL);
    expect(block?.text).toContain('<untrusted');

    source.setHead('main', 'sha-2');
    const after = await getTrace();
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain('CHANGED text');
    await app.close();
  });

  it('stored ../secrets.md seeded directly in DB -> invalid_path, no read', async () => {
    const source = new MockProjectDocsSource({ heads: { main: 'sha-1' }, files: { 'sha-1': { 'specs/sec.md': ORIGINAL } } });
    const { app, getTrace } = await runWith(['../secrets.md', 'specs/sec.md'], source);
    const tr = await getTrace();
    expect(tr.specs_read).toMatchObject([
      { path: '../secrets.md', status: 'skipped', reason: 'invalid_path' },
      { path: 'specs/sec.md', status: 'injected' },
    ]);
    const reads = source.calls.filter((c) => c.method === 'readBlob').map((c) => c.args[1]);
    expect(reads).toEqual(['specs/sec.md']);
    expect(tr.log.some((l) => l.msg.includes('skipped ../secrets.md (invalid_path)'))).toBe(true);
    await app.close();
  });
});
