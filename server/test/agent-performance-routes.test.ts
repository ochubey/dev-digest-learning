/**
 * agent-performance read routes via app.inject(). The repository is replaced by an
 * in-memory fake through prototype spies (as in multi-agent-routes.test.ts); no DB.
 * The SQL itself is covered by agent-performance.it.test.ts.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { AgentStats } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { AgentPerformanceRepository } from '../src/modules/agent-performance/repository.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { ReviewRunExecutor } from '../src/modules/reviews/run-executor.js';
import { AgentPerformance } from '../src/modules/agent-performance/schemas.js';
import type { RunAggRow } from '../src/modules/agent-performance/rules.js';

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const A1 = '44444444-4444-4444-8444-444444444441';
const A2 = '44444444-4444-4444-8444-444444444442';
const A3 = '44444444-4444-4444-8444-444444444443'; // never ran
const A_OTHER = '44444444-4444-4444-8444-444444444449';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

const baseEnv = { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv;
const fakeAuth = { currentUser: async () => ({ id: 'u1' }), currentWorkspace: async () => ({ id: WS }) };
const NOW = new Date('2026-10-18T12:00:00.000Z');

const FROM = '2026-09-01T00:00:00.000Z';
const TO = '2026-10-01T00:00:00.000Z';
const QS = `from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`;

let calls: { method: string; ws: unknown; args: unknown[] }[];
let writes: string[];
let closeApp: (() => Promise<void>) | null = null;

const runRows: RunAggRow[] = [
  { agentId: A1, counted: 4, excluded: 1, withCost: 3, totalCost: 0.03, durationSum: 8000, durationCount: 4, lastRanAt: new Date('2026-09-20T10:00:00.000Z') },
  { agentId: A2, counted: 2, excluded: 0, withCost: 2, totalCost: 0.01, durationSum: 3000, durationCount: 2, lastRanAt: new Date('2026-09-10T10:00:00.000Z') },
  { agentId: A_OTHER, counted: 99, excluded: 0, withCost: 0, totalCost: null, durationSum: null, durationCount: 0, lastRanAt: null },
];
const agentRows = [
  { id: A1, workspaceId: WS, name: 'Security' },
  { id: A2, workspaceId: WS, name: 'Perf' },
  { id: A3, workspaceId: WS, name: 'Idle' },
  { id: A_OTHER, workspaceId: OTHER_WS, name: 'Foreign' },
];

beforeEach(() => {
  calls = [];
  writes = [];
  const spy = (method: keyof AgentPerformanceRepository, impl: (ws: string, ...a: any[]) => unknown) =>
    vi.spyOn(AgentPerformanceRepository.prototype, method as never).mockImplementation((async (ws: string, ...args: unknown[]) => {
      calls.push({ method: method as string, ws, args });
      return impl(ws, ...args);
    }) as never);
  // Like the SQL, honour the agent filter and never return rows of other agents than asked for.
  const inIds = (ids: string[] | null, id: string) => !ids || ids.includes(id);
  spy('runAggregates', (_ws, _p, ids) => runRows.filter((r) => inIds(ids, r.agentId)));
  spy('findingAggregates', () => []);
  spy('dayCounts', () => new Map());
  spy('lastDoneAllTime', (_ws, ids) => new Map([[A3, new Date('2026-08-01T08:00:00.000Z')]].filter(([id]) => inIds(ids, id as string)) as [string, Date][]));
  spy('modelAggregates', () => [{ model: 'm/x', cost: 0.04, withCost: 5 }]);
  spy('deletedAgentRuns', () => 2);

  vi.spyOn(AgentsRepository.prototype, 'list').mockImplementation((async (ws: string) => {
    calls.push({ method: 'agents.list', ws, args: [] });
    return agentRows.filter((a) => a.workspaceId === ws);
  }) as never);
  vi.spyOn(AgentsRepository.prototype, 'getById').mockImplementation((async (ws: string, id: string) => {
    calls.push({ method: 'agents.getById', ws, args: [id] });
    return agentRows.find((a) => a.id === id && a.workspaceId === ws);
  }) as never);

  vi.spyOn(ReviewRunExecutor.prototype, 'executeRuns').mockImplementation((async () => {
    writes.push('executeRuns');
  }) as never);
});

afterEach(async () => {
  await closeApp?.();
  closeApp = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const boom = (what: string) =>
  new Proxy({}, { get: () => () => { throw new Error(`${what} must not be called`); } });

async function setup(extra: Record<string, unknown> = {}) {
  const app = await buildApp({
    config: loadConfig(baseEnv),
    db: {} as Db,
    overrides: { auth: fakeAuth as never, ...extra },
  });
  closeApp = () => app.close();
  return app;
}

const repoCalls = () => calls.filter((c) => !c.method.startsWith('agents.'));

describe('GET /agents/:id/stats', () => {
  it('200 with an AgentStats for the period, workspace passed to every repository call', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: `/agents/${A1}/stats?${QS}` });
    expect(res.statusCode).toBe(200);
    const s = AgentStats.parse(res.json());
    expect(s).toMatchObject({
      agent_id: A1, agent_name: 'Security', runs: 4, runs_excluded: 1, runs_with_cost: 3, runs_without_cost: 1,
      avg_latency_ms: 2000, cost_basis: 'estimate', period_from: FROM, period_to: TO,
    });
    expect(s.avg_cost_usd).toBeCloseTo(0.01, 12);
    expect(repoCalls().length).toBeGreaterThan(0);
    for (const c of calls) expect(c.ws).toBe(WS);
    // The aggregation is scoped to this agent only.
    expect(calls.find((c) => c.method === 'runAggregates')!.args[1]).toEqual([A1]);
  });

  it('404 for an unknown agent and for an agent of another workspace; nothing aggregated', async () => {
    const app = await setup();
    for (const id of [UNKNOWN, A_OTHER]) {
      const res = await app.inject({ method: 'GET', url: `/agents/${id}/stats?${QS}` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }
    expect(repoCalls()).toEqual([]);
  });

  it('a non-uuid id is 422', async () => {
    const app = await setup();
    expect((await app.inject({ method: 'GET', url: '/agents/nope/stats' })).statusCode).toBe(422);
  });

  it('an agent that never ran has zeros, null averages and last_run_at_all_time from history', async () => {
    const app = await setup();
    const s = AgentStats.parse((await app.inject({ method: 'GET', url: `/agents/${A3}/stats?${QS}` })).json());
    expect(s).toMatchObject({ runs: 0, avg_cost_usd: null, avg_latency_ms: null, accept_rate: null, last_run_at: null, last_run_at_all_time: '2026-08-01T08:00:00.000Z' });
  });
});

describe('GET /agent-performance', () => {
  it('200 with the envelope; three agents, one without runs, give three entries; other workspace excluded', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: `/agent-performance?${QS}` });
    expect(res.statusCode).toBe(200);
    const d = AgentPerformance.parse(res.json());
    expect(d.agents.map((a) => a.agent_id)).toEqual([A1, A2, A3]);
    expect(d.cost_basis).toBe('estimate');
    expect(d.period).toEqual({ from: FROM, to: TO });
    expect(d.totals).toMatchObject({ runs: 6, runs_excluded: 1, deleted_agent_runs: 2, runs_with_cost: 5, runs_without_cost: 1 });
    expect(d.totals.total_cost_usd).toBeCloseTo(0.04, 12);
    expect(d.most_active).toEqual({ agent_id: A1, agent_name: 'Security', runs: 4 });
    expect(d.cost_by_agent.map((c) => c.agent_name)).toEqual(['Security', 'Perf']);
    expect(d.cost_by_model).toEqual([{ model: 'm/x', cost_usd: 0.04, runs_with_cost: 5 }]);
    for (const c of calls) expect(c.ws).toBe(WS);
    // Fixed number of grouped queries, not one per agent.
    expect(repoCalls().map((c) => c.method).sort()).toEqual(
      ['deletedAgentRuns', 'dayCounts', 'findingAggregates', 'lastDoneAllTime', 'modelAggregates', 'runAggregates'].sort(),
    );
  });

  it('an entry equals GET /agents/:id/stats for the same period (AC-20 by construction)', async () => {
    const app = await setup();
    const dash = AgentPerformance.parse((await app.inject({ method: 'GET', url: `/agent-performance?${QS}` })).json());
    for (const a of dash.agents) {
      const one = (await app.inject({ method: 'GET', url: `/agents/${a.agent_id}/stats?${QS}` })).json();
      expect(one).toEqual(a);
    }
  });

  it('a workspace without agents answers 200 with empty lists and no run queries', async () => {
    const app = await setup();
    vi.spyOn(AgentsRepository.prototype, 'list').mockResolvedValue([] as never);
    const d = AgentPerformance.parse((await app.inject({ method: 'GET', url: `/agent-performance?${QS}` })).json());
    expect(d.agents).toEqual([]);
    expect(d.totals).toMatchObject({ runs: 0, total_cost_usd: null, accept_rate: null });
    expect(d.most_active).toBeNull();
  });
});

describe('period handling (both endpoints)', () => {
  const bad = [
    ['from >= to', `from=${encodeURIComponent(TO)}&to=${encodeURIComponent(FROM)}`],
    ['from == to', `from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(FROM)}`],
    ['367 days', 'from=2025-01-01T00:00:00Z&to=2026-01-03T00:00:00Z'],
    ['invalid ISO', 'from=yesterday&to=today'],
    ['date without time', 'from=2026-09-01&to=2026-09-30'],
    ['only from', `from=${encodeURIComponent(FROM)}`],
    ['only to', `to=${encodeURIComponent(TO)}`],
  ] as const;

  for (const [label, qs] of bad) {
    it(`422 validation_error for ${label}, repository never called`, async () => {
      const app = await setup();
      for (const url of [`/agent-performance?${qs}`, `/agents/${A1}/stats?${qs}`]) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode).toBe(422);
        expect(res.json().error.code).toBe('validation_error');
      }
      expect(calls).toEqual([]);
    });
  }

  it('no params: the 30 days ending at request time (fixed clock)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const app = await setup();
    const d = AgentPerformance.parse((await app.inject({ method: 'GET', url: '/agent-performance' })).json());
    expect(d.period).toEqual({ from: '2026-09-18T12:00:00.000Z', to: '2026-10-18T12:00:00.000Z' });
    const s = AgentStats.parse((await app.inject({ method: 'GET', url: `/agents/${A1}/stats` })).json());
    expect([s.period_from, s.period_to]).toEqual(['2026-09-18T12:00:00.000Z', '2026-10-18T12:00:00.000Z']);
  });

  it('an offset input is echoed as UTC Z', async () => {
    const app = await setup();
    const qs = `from=${encodeURIComponent('2026-09-01T02:00:00+02:00')}&to=${encodeURIComponent('2026-10-01T02:00:00+02:00')}`;
    const d = AgentPerformance.parse((await app.inject({ method: 'GET', url: `/agent-performance?${qs}` })).json());
    expect(d.period).toEqual({ from: FROM, to: TO });
    const s = AgentStats.parse((await app.inject({ method: 'GET', url: `/agents/${A1}/stats?${qs}` })).json());
    expect([s.period_from, s.period_to]).toEqual([FROM, TO]);
  });

  it('the repository receives the resolved Date instants', async () => {
    const app = await setup();
    await app.inject({ method: 'GET', url: `/agent-performance?${QS}` });
    const run = calls.find((c) => c.method === 'runAggregates')!;
    const period = run.args[0] as { from: Date; to: Date };
    expect(period.from.toISOString()).toBe(FROM);
    expect(period.to.toISOString()).toBe(TO);
  });
});

describe('read-only and no model calls', () => {
  it('POST/PUT/DELETE/PATCH on both paths are not served (404 or 405)', async () => {
    const app = await setup();
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'] as const) {
      for (const url of [`/agent-performance?${QS}`, `/agents/${A1}/stats?${QS}`]) {
        const res = await app.inject({ method, url, payload: {} });
        expect([404, 405]).toContain(res.statusCode);
      }
    }
    expect(calls).toEqual([]);
  });

  it('with LLM providers, embedder, GitHub client, CI source and run executor set to throw, GETs stay 200', async () => {
    const app = await setup({
      llm: { openai: boom('openai'), anthropic: boom('anthropic'), openrouter: boom('openrouter') },
      embedder: boom('embedder'),
      github: boom('github'),
      actions: boom('actions'),
    });
    vi.spyOn(ReviewRunExecutor.prototype, 'executeRuns').mockImplementation((async () => {
      throw new Error('run executor must not be called');
    }) as never);
    const a = await app.inject({ method: 'GET', url: `/agent-performance?${QS}` });
    const b = await app.inject({ method: 'GET', url: `/agents/${A1}/stats?${QS}` });
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(writes).toEqual([]);
  });

  it('the repository exposes SELECT-style reads only', () => {
    const methods = Object.getOwnPropertyNames(AgentPerformanceRepository.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(
      ['agentFilter', 'dayCounts', 'deletedAgentRuns', 'findingAggregates', 'lastDoneAllTime', 'modelAggregates', 'runAggregates', 'runScope'],
    );
  });
});
