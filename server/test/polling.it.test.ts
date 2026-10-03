/**
 * Manual repo poll — POST /repos/:id/poll. Syncs the PR list from GitHub
 * (idempotent upsert) and bumps last_polled_at; does NOT trigger a review.
 * Gated on Docker (needs Postgres), matching the other integration tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const PULL: PrMeta = {
  number: 12,
  title: 'Fix flaky retry logic',
  author: 'marisa.koch',
  branch: 'fix/retry',
  base: 'main',
  head_sha: 'cafef00d',
  additions: 10,
  deletions: 2,
  files_count: 1,
  status: 'open',
  opened_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

d('poll route (Testcontainers pg)', () => {
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

  it('syncs PRs from GitHub and bumps last_polled_at, without triggering a review', async () => {
    const gh = new MockGitHubClient({ pulls: [PULL] });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'polled-repo', fullName: 'acme/polled-repo' })
      .returning();

    const res = await app.inject({ method: 'POST', url: `/repos/${repo!.id}/poll` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ synced: 1, reviewTriggered: false });

    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo!.id));
    expect(pr).toMatchObject({ number: 12, title: 'Fix flaky retry logic', headSha: 'cafef00d' });

    const [updatedRepo] = await pg.handle.db.select().from(t.repos).where(eq(t.repos.id, repo!.id));
    expect(updatedRepo!.lastPolledAt).not.toBeNull();
  });

  it('is idempotent on re-poll (upserts, no duplicate row)', async () => {
    const gh = new MockGitHubClient({ pulls: [PULL] });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'polled-repo-2', fullName: 'acme/polled-repo-2' })
      .returning();

    await app.inject({ method: 'POST', url: `/repos/${repo!.id}/poll` });
    await app.inject({ method: 'POST', url: `/repos/${repo!.id}/poll` });

    const rows = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo!.id));
    expect(rows).toHaveLength(1);
  });

  it('404s for an unknown repo id', async () => {
    const gh = new MockGitHubClient({ pulls: [PULL] });
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: gh } });

    const res = await app.inject({
      method: 'POST',
      url: `/repos/00000000-0000-0000-0000-000000000000/poll`,
    });
    expect(res.statusCode).toBe(404);
  });
});
