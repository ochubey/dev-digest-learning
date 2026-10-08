/**
 * POST/GET /pulls/:id/brief against a real Postgres (Testcontainers): the pr_brief row is
 * really written, left alone on failure, and holds no source content. Model, GitHub, git and
 * repo-intel are stubbed. Skipped when Docker is unavailable.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { ExternalServiceError } from '../src/platform/errors.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () =>
  loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

const SENTINEL = 'ISSUE-SPEC-SENTINEL-77';
const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,6 @@',
  ' a',
  '+b',
  '+c',
  '+d',
  '+e',
].join('\n');

const OUTPUT = {
  summary: 'It adds the thing.',
  risks: [{ kind: 'correctness', title: 'Edge', explanation: 'x', severity: 'high', file_refs: ['src/a.ts'] }],
  review_focus: [{ file: 'src/a.ts', line: 3, reason: 'core' }],
};

let seq = 100;

d('PR brief (Testcontainers pg)', () => {
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

  async function makePr(body: string) {
    const db = pg.handle.db;
    const name = `brief-${seq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Add thing',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'sha-it-1',
        additions: 4,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body,
      })
      .returning();
    return pr!;
  }

  async function makeApp(over: { llm?: MockLLMProvider; github?: MockGitHubClient; degraded?: boolean } = {}) {
    const llm = over.llm ?? new MockLLMProvider('openai', { structured: OUTPUT });
    const github = over.github ?? new MockGitHubClient();
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        github,
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llm, anthropic: llm, openrouter: llm },
        repoIntel: {
          getBlastRadius: async () =>
            over.degraded
              ? { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true, reason: 'no_index' }
              : {
                  changedSymbols: [{ file: 'src/a.ts', name: 'doThing', kind: 'function' }],
                  callers: [{ file: 'src/c.ts', symbol: 'run', viaSymbol: 'doThing', line: 2, rank: 1 }],
                  impactedEndpoints: [],
                },
        } as never,
      },
    });
    return { app, llm, github };
  }

  const rowOf = async (prId: string) => {
    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row;
  };

  it('POST stores exactly one pr_brief row whose JSON carries generated_from_head_sha; GET returns it', async () => {
    const pr = await makePr('Adds the thing.');
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const rows = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, pr.id));
    expect(rows).toHaveLength(1);
    expect((rows[0]!.json as { meta: { generated_from_head_sha: string } }).meta.generated_from_head_sha).toBe(
      'sha-it-1',
    );
    const got = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ pr_id: pr.id, stale: false, summary: OUTPUT.summary });
    await app.close();
  });

  it('a failing model call returns 502 and leaves a seeded row unchanged', async () => {
    const pr = await makePr('Adds the thing.');
    const seeded = { seeded: true };
    await pg.handle.db.insert(t.prBrief).values({ prId: pr.id, json: seeded });
    const llm = new MockLLMProvider('openai', {});
    vi.spyOn(llm, 'completeStructured').mockRejectedValue(
      new ExternalServiceError('OpenAI structured output failed schema validation'),
    );
    const { app } = await makeApp({ llm });
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(502);
    expect((await rowOf(pr.id))!.json).toEqual(seeded);
    await app.close();
  });

  it('the stored row holds no sentinel from the issue body or the spec doc', async () => {
    const pr = await makePr('Fixes #5. Spec: docs/my-spec.md');
    const github = new MockGitHubClient();
    vi.spyOn(github, 'getIssue').mockResolvedValue({ number: 5, title: 'An issue', body: SENTINEL } as never);
    vi.spyOn(github, 'readRepoFile').mockResolvedValue(`# Spec\n${SENTINEL}`);
    const { app, llm } = await makeApp({ github });
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    // the model saw the content ...
    const sent = JSON.stringify((llm.calls.find((c) => c.method === 'completeStructured')!.req as { messages: unknown }).messages);
    expect(sent).toContain(SENTINEL);
    // ... but it is not persisted anywhere in the row
    const row = await rowOf(pr.id);
    expect(JSON.stringify(row!.json)).not.toContain(SENTINEL);
    expect((row!.json as { meta: { sources: unknown[] } }).meta.sources).toEqual(
      expect.arrayContaining([
        { label: 'Linked issue #5', status: 'fetched' },
        { label: 'Spec at docs/my-spec.md', status: 'fetched' },
      ]),
    );
    await app.close();
  });

  it('no pr_intent row plus a degraded index: meta.missing includes intent and blast', async () => {
    const pr = await makePr('Adds the thing.');
    const { app } = await makeApp({ degraded: true });
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief` });
    expect(res.statusCode).toBe(200);
    const missing = (res.json() as { meta: { missing: string[] } }).meta.missing;
    expect(missing).toEqual(expect.arrayContaining(['intent', 'blast']));
    expect(missing.indexOf('intent')).toBeLessThan(missing.indexOf('blast'));
    expect(res.json().intent).toBeNull();
    await app.close();
  });
});
