/** GET /multi-agent-runs/latest via app.inject(); repository replaced by an in-memory spy (no DB). */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { LatestMultiAgentRun } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { MultiAgentRepository } from '../src/modules/multi-agent/repository.js';

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const REPO = '33333333-3333-4333-8333-333333333333';
const OTHER_REPO = '33333333-3333-4333-8333-333333333334';
const MA_OLD = '55555555-5555-4555-8555-555555555551';
const MA_NEW = '55555555-5555-4555-8555-555555555552';
const MA_FOREIGN = '55555555-5555-4555-8555-555555555553';

const fakeAuth = { currentUser: async () => ({ id: 'u1' }), currentWorkspace: async () => ({ id: WS }) };
const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

const rows = [
  { id: MA_OLD, workspaceId: WS, repoId: REPO, ranAt: new Date('2026-01-01T10:00:00Z') },
  { id: MA_NEW, workspaceId: WS, repoId: REPO, ranAt: new Date('2026-01-02T10:00:00Z') },
  { id: MA_FOREIGN, workspaceId: OTHER_WS, repoId: REPO, ranAt: new Date('2026-02-01T10:00:00Z') },
];

let closeApp: (() => Promise<void>) | null = null;
beforeEach(() => {
  vi.spyOn(MultiAgentRepository.prototype, 'latestForRepo').mockImplementation((async (ws: string, repoId: string) =>
    rows
      .filter((r) => r.workspaceId === ws && r.repoId === repoId)
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())[0]?.id ?? null) as never);
  const getParent = vi.spyOn(MultiAgentRepository.prototype, 'getParent').mockResolvedValue(undefined);
  void getParent;
});
afterEach(async () => {
  await closeApp?.();
  closeApp = null;
  vi.restoreAllMocks();
});

async function setup() {
  const app = await buildApp({ config, db: {} as Db, overrides: { auth: fakeAuth as never } });
  closeApp = () => app.close();
  return app;
}

describe('GET /multi-agent-runs/latest', () => {
  it('returns the newest run of the repo in the caller workspace', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/latest?repoId=${REPO}` });
    expect(res.statusCode).toBe(200);
    expect(LatestMultiAgentRun.parse(res.json())).toEqual({ id: MA_NEW });
  });

  it('returns { id: null } when the repo has no runs', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/latest?repoId=${OTHER_REPO}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: null });
  });

  it('does not clash with /multi-agent-runs/:id and validates repoId', async () => {
    const app = await setup();
    const bad = await app.inject({ method: 'GET', url: '/multi-agent-runs/latest?repoId=nope' });
    expect(bad.statusCode).toBe(422);
    const missing = await app.inject({ method: 'GET', url: '/multi-agent-runs/latest' });
    expect(missing.statusCode).toBe(422);
    const byId = await app.inject({ method: 'GET', url: `/multi-agent-runs/${MA_NEW}` });
    expect(byId.statusCode).toBe(404); // routed to :id (getParent spy -> not found), not to /latest
  });
});
