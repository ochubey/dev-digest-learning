import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { GitHubClient, SecretsProvider } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const badCreds = Object.assign(new Error('Bad credentials - https://docs.github.com/rest'), { status: 401 });
const rejectingGithub = {
  listPullRequests: async () => {
    throw badCreds;
  },
  getPullRequest: async () => {
    throw badCreds;
  },
  currentLogin: async () => {
    throw badCreds;
  },
} as unknown as GitHubClient;
const withToken: SecretsProvider = { get: async (k) => (k === 'GITHUB_TOKEN' ? 'expired-token' : undefined) };

d('GitHub sync status + real token check (Testcontainers pg)', () => {
  let pg: PgFixture;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [repo] = await pg.handle.db.select().from(t.repos);
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('a rejected token shows up as ok:false / bad_credentials in sync-status after listing PRs', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: rejectingGithub, secrets: withToken } });

    // nothing attempted yet -> nothing known to be wrong
    expect((await app.inject({ method: 'GET', url: `/repos/${repoId}/sync-status` })).json().ok).toBe(true);

    // the list still serves persisted PRs (does not fail) ...
    const list = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBeGreaterThan(0);

    // ... but the failure is now visible
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/sync-status` });
    expect(res.json()).toMatchObject({ ok: false, reason: 'bad_credentials', status: 401, message: 'Bad credentials' });
    await app.close();
  });

  it('sync-status recovers to ok after a successful sync', async () => {
    const okGithub = { listPullRequests: async () => [], getPullRequest: async () => ({}), currentLogin: async () => 'me' } as unknown as GitHubClient;
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: okGithub, secrets: withToken } });
    await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect((await app.inject({ method: 'GET', url: `/repos/${repoId}/sync-status` })).json().ok).toBe(true);
    await app.close();
  });

  it('GET /settings/github-status really calls GitHub: expired token -> ok:false; missing -> no_token; valid -> login', async () => {
    let app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: rejectingGithub, secrets: withToken } });
    expect((await app.inject({ method: 'GET', url: '/settings/github-status' })).json()).toMatchObject({
      configured: true,
      ok: false,
      reason: 'bad_credentials',
    });
    await app.close();

    app = await buildApp({ config: config(), db: pg.handle.db, overrides: { secrets: { get: async () => undefined } } });
    expect((await app.inject({ method: 'GET', url: '/settings/github-status' })).json()).toMatchObject({
      configured: false,
      ok: false,
      reason: 'no_token',
    });
    await app.close();

    const okGithub = { currentLogin: async () => 'octocat' } as unknown as GitHubClient;
    app = await buildApp({ config: config(), db: pg.handle.db, overrides: { github: okGithub, secrets: withToken } });
    const ok = (await app.inject({ method: 'GET', url: '/settings/github-status' })).json();
    expect(ok).toEqual({ configured: true, ok: true, login: 'octocat' });
    // the token value itself is never part of the response
    expect(JSON.stringify(ok)).not.toContain('expired-token');
    await app.close();
  });
});
