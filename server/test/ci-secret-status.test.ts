/** GET /ci/secret-status via app.inject() + the Octokit adapter's secretExists. No DB, no network. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { CiSecretStatus } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { CiRepository } from '../src/modules/ci/repository.js';
import { OctokitActionsSource } from '../src/adapters/github-actions/octokit.js';
import { FakeCiRepo, WS, REPO_ID } from './helpers/ci-store.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
const fakeAuth = { currentUser: async () => ({ id: 'u1' }), currentWorkspace: async () => ({ id: WS }) };
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

let closeApp: (() => Promise<void>) | null = null;
let store: FakeCiRepo;
let actions: { secretExists: ReturnType<typeof vi.fn> };
beforeEach(() => {
  store = new FakeCiRepo();
  actions = { secretExists: vi.fn(async () => 'set') };
  vi.spyOn(CiRepository.prototype, 'findRepoById').mockImplementation(((...a: unknown[]) =>
    (store.findRepoById as (...x: unknown[]) => unknown)(...a)) as never);
});
afterEach(async () => {
  await closeApp?.();
  closeApp = null;
  vi.restoreAllMocks();
});

async function setup() {
  const app = await buildApp({ config, db: {} as Db, overrides: { auth: fakeAuth as never, actions: actions as never } });
  closeApp = () => app.close();
  return app;
}

describe('GET /ci/secret-status', () => {
  it.each(['set', 'not_set', 'unknown'] as const)('maps %s through', async (state) => {
    actions.secretExists.mockResolvedValue(state);
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: `/ci/secret-status?repoId=${REPO_ID}` });
    expect(res.statusCode).toBe(200);
    expect(CiSecretStatus.parse(res.json())).toEqual({ OPENROUTER_API_KEY: state });
    expect(actions.secretExists).toHaveBeenCalledWith('acme/widgets', 'OPENROUTER_API_KEY');
  });

  it('a throwing source degrades to unknown', async () => {
    actions.secretExists.mockRejectedValue(new Error('network'));
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: `/ci/secret-status?repoId=${REPO_ID}` });
    expect(res.json()).toEqual({ OPENROUTER_API_KEY: 'unknown' });
  });

  it('unknown repo -> 404 without calling GitHub; bad repoId -> 422', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: `/ci/secret-status?repoId=${UNKNOWN}` });
    expect(res.statusCode).toBe(404);
    expect(actions.secretExists).not.toHaveBeenCalled();
    const bad = await app.inject({ method: 'GET', url: '/ci/secret-status?repoId=x' });
    expect(bad.statusCode).toBe(422);
  });
});

describe('OctokitActionsSource.secretExists', () => {
  const source = (getRepoSecret: unknown) => {
    const s = new OctokitActionsSource('ghp_FAKE');
    (s as unknown as { octokit: unknown }).octokit = { rest: { actions: { getRepoSecret } } };
    return s;
  };
  const fail = (status?: number) => async () => {
    throw Object.assign(new Error('x'), status ? { status } : {});
  };

  it('200 -> set (name only is requested)', async () => {
    const get = vi.fn(async () => ({ data: { name: 'OPENROUTER_API_KEY' } }));
    expect(await source(get).secretExists('acme/widgets', 'OPENROUTER_API_KEY')).toBe('set');
    expect(get).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets', secret_name: 'OPENROUTER_API_KEY' });
  });
  it('404 -> not_set; 403 and network errors -> unknown', async () => {
    expect(await source(fail(404)).secretExists('a/b', 'N')).toBe('not_set');
    expect(await source(fail(403)).secretExists('a/b', 'N')).toBe('unknown');
    expect(await source(fail()).secretExists('a/b', 'N')).toBe('unknown');
  });
});
