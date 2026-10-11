/**
 * POST /pulls/:id/review with {agentIds} via app.inject(). The repositories are
 * replaced by in-memory spies (no DB); the background executor is stubbed so the
 * "LLM" never resolves. Rows are asserted through the recorded repository calls.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const PR_ID = '88888888-8888-4888-8888-888888888888';
const A1 = '44444444-4444-4444-8444-444444444441';
const A2 = '44444444-4444-4444-8444-444444444442';
const A3 = '44444444-4444-4444-8444-444444444443';
const FOREIGN = '44444444-4444-4444-8444-444444444449';

const baseEnv = { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv;
const fakeAuth = { currentUser: async () => ({ id: 'u1' }), currentWorkspace: async () => ({ id: WS }) };

interface ParentRow { id: string; workspaceId: string; prId: string }
interface ChildRow { id: string; workspaceId: string; agentId: string | null; prId: string; status: 'running'; multiAgentRunId: string | null }

const agentRow = (id: string, name: string, workspaceId = WS) =>
  ({ id, name, workspaceId, provider: 'openai', model: 'm', enabled: true, version: 1 }) as never;

let agents: Map<string, { id: string; workspaceId: string }>;
let parents: ParentRow[];
let children: ChildRow[];
let executeRuns: ReturnType<typeof vi.fn>;
let closeApp: (() => Promise<void>) | null = null;

beforeEach(() => {
  parents = [];
  children = [];
  agents = new Map([
    [A1, agentRow(A1, 'Security')],
    [A2, agentRow(A2, 'Perf')],
    [A3, agentRow(A3, 'Style')],
    [FOREIGN, agentRow(FOREIGN, 'Foreign', OTHER_WS)],
  ] as never);

  vi.spyOn(AgentsRepository.prototype, 'getById').mockImplementation((async (ws: string, id: string) => {
    const a = agents.get(id);
    return a && a.workspaceId === ws ? a : undefined;
  }) as never);
  vi.spyOn(AgentsRepository.prototype, 'listEnabled').mockImplementation((async (ws: string) =>
    [...agents.values()].filter((a) => a.workspaceId === ws)) as never);

  vi.spyOn(ReviewRepository.prototype, 'getPull').mockImplementation((async (ws: string, id: string) =>
    ws === WS && id === PR_ID ? { id: PR_ID, repoId: 'r', number: 7, headSha: 'h' } : undefined) as never);
  vi.spyOn(ReviewRepository.prototype, 'getRepo').mockImplementation((async () => ({ id: 'r', owner: 'o', name: 'n' })) as never);
  vi.spyOn(ReviewRepository.prototype, 'createMultiAgentRun').mockImplementation((async (v: { workspaceId: string; prId: string }) => {
    const id = `ma-${parents.length + 1}`;
    parents.push({ id, ...v });
    return id;
  }) as never);
  vi.spyOn(ReviewRepository.prototype, 'createAgentRun').mockImplementation((async (v: Omit<ChildRow, 'id' | 'status' | 'multiAgentRunId'> & { multiAgentRunId?: string | null }) => {
    const id = `run-${children.length + 1}`;
    children.push({ id, status: 'running', ...v, multiAgentRunId: v.multiAgentRunId ?? null });
    return id;
  }) as never);

  // The "LLM" never resolves: the background execution stays pending forever.
  executeRuns = vi.fn(() => new Promise<void>(() => undefined));
  vi.spyOn(ReviewRunExecutor.prototype, 'executeRuns').mockImplementation(executeRuns as never);
});

afterEach(async () => {
  await closeApp?.();
  closeApp = null;
  vi.restoreAllMocks();
});

async function post(body: unknown) {
  await closeApp?.();
  const app = await buildApp({
    config: loadConfig(baseEnv),
    db: {} as Db,
    overrides: { auth: fakeAuth as never },
  });
  closeApp = () => app.close();
  return app.inject({ method: 'POST', url: `/pulls/${PR_ID}/review`, payload: body as never });
}

const noRows = () => {
  expect(parents).toEqual([]);
  expect(children).toEqual([]);
  expect(executeRuns).not.toHaveBeenCalled();
};

describe('POST /pulls/:id/review {agentIds}', () => {
  it('valid agentIds: one parent row, three linked running children', async () => {
    const res = await post({ agentIds: [A3, A1, A2] });
    expect(res.statusCode).toBe(200);
    expect(parents).toEqual([{ id: 'ma-1', workspaceId: WS, prId: PR_ID }]);
    expect(children).toHaveLength(3);
    expect(children.map((c) => c.agentId)).toEqual([A3, A1, A2]); // request order kept
    for (const c of children) {
      expect(c).toMatchObject({ status: 'running', multiAgentRunId: 'ma-1', workspaceId: WS, prId: PR_ID });
    }
  });

  it('answers with {pr_id, runs(3), reviews: [], multi_agent_run_id} while the LLM never resolves', async () => {
    const res = await post({ agentIds: [A1, A2, A3] });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pr_id).toBe(PR_ID);
    expect(body.runs).toHaveLength(3);
    expect(body.runs.map((r: { agent_id: string }) => r.agent_id)).toEqual([A1, A2, A3]);
    expect(body.reviews).toEqual([]);
    expect(body.multi_agent_run_id).toBe('ma-1');
    expect(executeRuns).toHaveBeenCalledTimes(1); // started, never awaited
  });

  it('422 validation_error for [], 6 ids, duplicates; no rows', async () => {
    const six = Array.from({ length: 6 }, (_, i) => `44444444-4444-4444-8444-44444444440${i}`);
    for (const agentIds of [[], six, [A1, A1]]) {
      const res = await post({ agentIds });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    }
    noRows();
  });

  it('400 invalid_run_request for agentIds+agentId and agentIds+all; no rows', async () => {
    for (const body of [{ agentIds: [A1], agentId: A2 }, { agentIds: [A1], all: true }]) {
      const res = await post(body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('invalid_run_request');
    }
    noRows();
  });

  it('404 for one foreign id; zero parent and child rows', async () => {
    const res = await post({ agentIds: [A1, FOREIGN, A2] });
    expect(res.statusCode).toBe(404);
    noRows();
    const unknown = await post({ agentIds: ['44444444-4444-4444-8444-444444444400'] });
    expect(unknown.statusCode).toBe(404);
    noRows();
  });

  it('{agentId} and {all:true}: no parent row, null link, no multi_agent_run_id in response', async () => {
    const one = await post({ agentId: A1 });
    expect(one.statusCode).toBe(200);
    expect(one.json()).not.toHaveProperty('multi_agent_run_id');
    expect(one.json().runs).toHaveLength(1);

    const all = await post({ all: true });
    expect(all.statusCode).toBe(200);
    expect(all.json()).not.toHaveProperty('multi_agent_run_id');
    expect(all.json().runs).toHaveLength(3);

    expect(parents).toEqual([]);
    expect(children.length).toBe(4);
    expect(children.every((c) => c.multiAgentRunId === null)).toBe(true);
  });
});
