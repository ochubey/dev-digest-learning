/**
 * Multi-agent read routes via app.inject(). Repositories are replaced by an
 * in-memory store (prototype spies, as in evals-routes.test.ts); no DB.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { AgentRunEstimate, MultiAgentRun } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { MultiAgentRepository } from '../src/modules/multi-agent/repository.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import type { ChildRun, ParentRun, ReviewWithFindings } from '../src/modules/multi-agent/read-model.js';

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const PR_ID = '88888888-8888-4888-8888-888888888888';
const MA_ID = '55555555-5555-4555-8555-555555555551';
const OTHER_MA_ID = '55555555-5555-4555-8555-555555555552';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const A1 = '44444444-4444-4444-8444-444444444441';
const A2 = '44444444-4444-4444-8444-444444444442';
const A_OTHER = '44444444-4444-4444-8444-444444444449';

const baseEnv = { ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv;
const fakeAuth = { currentUser: async () => ({ id: 'u1' }), currentWorkspace: async () => ({ id: WS }) };
const T0 = new Date('2026-01-01T10:00:00.000Z');

interface DoneRun { workspaceId: string; agentId: string; status: string; durationMs: number | null; costUsd: number | null; ranAt: Date }

let parents: (ParentRun & { workspaceId: string })[];
let children: Map<string, ChildRun[]>;
let reviews: ReviewWithFindings[];
let agentRuns: DoneRun[];
let agents: { id: string; workspaceId: string }[];
let writes: string[];
let closeApp: (() => Promise<void>) | null = null;

const dbFinding = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  file: 'src/a.ts',
  startLine: 10,
  endLine: 10,
  severity: 'WARNING',
  category: 'bug',
  title: 'Odd thing',
  kind: 'finding',
  scope: null,
  ...over,
});

beforeEach(() => {
  writes = [];
  parents = [
    { id: MA_ID, prId: PR_ID, ranAt: T0, workspaceId: WS },
    { id: OTHER_MA_ID, prId: PR_ID, ranAt: T0, workspaceId: OTHER_WS },
  ];
  const run = (id: string, agentId: string, name: string): ChildRun => ({
    id, agentId, agentName: name, provider: 'openai', model: 'm', status: 'done', error: null,
    durationMs: 2000, costUsd: 0.1, score: 80, ranAt: T0,
  });
  children = new Map([
    [MA_ID, [run('run-1', A1, 'Security'), run('run-2', A2, 'Perf')]],
    [OTHER_MA_ID, [run('run-x', A_OTHER, 'Foreign')]],
  ]);
  reviews = [
    { review: { runId: 'run-1', kind: 'review', verdict: 'comment', summary: 's1', score: 80 }, findings: [dbFinding('f1', { severity: 'CRITICAL' })] },
    { review: { runId: 'run-2', kind: 'review', verdict: 'comment', summary: 's2', score: 70 }, findings: [dbFinding('f2'), dbFinding('f3', { startLine: 90, endLine: 90, title: 'Other' })] },
  ];
  agents = [
    { id: A1, workspaceId: WS },
    { id: A2, workspaceId: WS },
    { id: A_OTHER, workspaceId: OTHER_WS },
  ];
  agentRuns = [];

  vi.spyOn(MultiAgentRepository.prototype, 'getParent').mockImplementation((async (ws: string, id: string) =>
    parents.find((p) => p.id === id && p.workspaceId === ws)) as never);
  vi.spyOn(MultiAgentRepository.prototype, 'childRuns').mockImplementation((async (_ws: string, id: string) =>
    children.get(id) ?? []) as never);
  vi.spyOn(MultiAgentRepository.prototype, 'reviewsForRuns').mockImplementation((async (_ws: string, ids: string[]) =>
    reviews.filter((r) => r.review.runId && ids.includes(r.review.runId))) as never);
  vi.spyOn(MultiAgentRepository.prototype, 'pullNumber').mockImplementation((async () => 482) as never);
  vi.spyOn(MultiAgentRepository.prototype, 'lastDoneRuns').mockImplementation((async (ws: string, agentId: string, limit: number) =>
    agentRuns
      .filter((r) => r.workspaceId === ws && r.agentId === agentId && r.status === 'done')
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
      .slice(0, limit)
      .map((r) => ({ duration_ms: r.durationMs, cost_usd: r.costUsd }))) as never);

  vi.spyOn(AgentsRepository.prototype, 'list').mockImplementation((async (ws: string) =>
    agents.filter((a) => a.workspaceId === ws)) as never);
  vi.spyOn(AgentsRepository.prototype, 'getById').mockImplementation((async (ws: string, id: string) => {
    const a = agents.find((x) => x.id === id && x.workspaceId === ws);
    return a ? { ...a, name: `name-${id.slice(-1)}` } : undefined;
  }) as never);

  // GET /pulls/:id/reviews goes through ReviewRepository: serve the same rows.
  vi.spyOn(ReviewRepository.prototype, 'getPull').mockImplementation((async (ws: string, id: string) =>
    ws === WS && id === PR_ID ? { id: PR_ID } : undefined) as never);
  vi.spyOn(ReviewRepository.prototype, 'reviewsForPull').mockImplementation((async () =>
    reviews.map((r, i) => ({
      review: {
        id: `rev-${i}`, prId: PR_ID, agentId: i === 0 ? A1 : A2, runId: r.review.runId, kind: r.review.kind,
        verdict: r.review.verdict, summary: r.review.summary, score: r.review.score, model: 'm', createdAt: T0,
      },
      findings: r.findings.map((f) => ({
        ...f, reviewId: `rev-${i}`, rationale: 'r', suggestion: null, confidence: 0.9,
        trifectaComponents: null, scopeReason: null, acceptedAt: null, dismissedAt: null,
      })),
    }))) as never);

  // Every mutator on the review repository records itself: reads must never call them.
  for (const m of [
    'insertReview', 'insertFindings', 'createAgentRun', 'createMultiAgentRun', 'completeAgentRun',
    'saveRunTrace', 'markReviewed', 'deleteReview', 'deleteAgentRun', 'cancelRunIfRunning',
    'setFindingAccepted', 'setFindingDismissed',
  ] as const) {
    vi.spyOn(ReviewRepository.prototype, m as never).mockImplementation((async () => {
      writes.push(m);
    }) as never);
  }
});

afterEach(async () => {
  await closeApp?.();
  closeApp = null;
  vi.restoreAllMocks();
});

async function setup() {
  const app = await buildApp({
    config: loadConfig(baseEnv),
    db: {} as Db,
    overrides: { auth: fakeAuth as never },
  });
  closeApp = () => app.close();
  return app;
}

describe('GET /multi-agent-runs/:id', () => {
  it('own workspace parses with MultiAgentRun', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/${MA_ID}` });
    expect(res.statusCode).toBe(200);
    const run = MultiAgentRun.parse(res.json());
    expect(run).toMatchObject({ id: MA_ID, pr_id: PR_ID, pr_number: 482, agent_count: 2 });
    expect(run.columns.map((c) => c.agent_name)).toEqual(['Perf', 'Security']);
    expect(run.groups.length).toBeGreaterThan(0);
  });

  it('foreign-workspace and unknown id -> 404', async () => {
    const app = await setup();
    const foreign = await app.inject({ method: 'GET', url: `/multi-agent-runs/${OTHER_MA_ID}` });
    expect(foreign.statusCode).toBe(404);
    const unknown = await app.inject({ method: 'GET', url: `/multi-agent-runs/${UNKNOWN}` });
    expect(unknown.statusCode).toBe(404);
    const bad = await app.inject({ method: 'GET', url: '/multi-agent-runs/not-a-uuid' });
    expect(bad.statusCode).toBe(422);
  });

  it('GET /pulls/:id/reviews identical before and after GET /multi-agent-runs/:id; no insert/update/delete called', async () => {
    const app = await setup();
    const before = await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/reviews` });
    expect(before.statusCode).toBe(200);
    const run = await app.inject({ method: 'GET', url: `/multi-agent-runs/${MA_ID}` });
    expect(run.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: `/pulls/${PR_ID}/reviews` });
    expect(after.json()).toEqual(before.json());
    expect(writes).toEqual([]);

    // The multi-agent repository exposes reads only.
    const methods = Object.getOwnPropertyNames(MultiAgentRepository.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['childRuns', 'getParent', 'lastDoneRuns', 'pullNumber', 'reviewsForRuns']);
  });

  it("returned findings' attribution equals their reviews rows", async () => {
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: `/multi-agent-runs/${MA_ID}` });
    const run = MultiAgentRun.parse(res.json());
    const byRun = new Map(run.columns.map((c) => [c.run_id, c]));
    for (const { review, findings } of reviews) {
      const col = byRun.get(review.runId!)!;
      expect(col.findings.map((f) => f.id).sort()).toEqual(findings.map((f) => f.id).sort());
      for (const f of col.findings) {
        expect(f).toMatchObject({ run_id: review.runId, agent_id: col.agent_id, agent_name: col.agent_name });
      }
    }
    expect(byRun.get('run-1')!.agent_id).toBe(A1);
    expect(byRun.get('run-2')!.agent_id).toBe(A2);
  });
});

describe('GET /multi-agent/estimates', () => {
  it("returns only the caller's workspace agents", async () => {
    agentRuns.push(
      { workspaceId: WS, agentId: A1, status: 'done', durationMs: 4000, costUsd: 0.2, ranAt: T0 },
      { workspaceId: OTHER_WS, agentId: A_OTHER, status: 'done', durationMs: 1, costUsd: 9, ranAt: T0 },
    );
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: '/multi-agent/estimates' });
    expect(res.statusCode).toBe(200);
    const list = AgentRunEstimate.array().parse(res.json());
    expect(list.map((e) => e.agent_id).sort()).toEqual([A1, A2]);
    expect(list.find((e) => e.agent_id === A1)).toMatchObject({ sample_size: 1, avg_duration_ms: 4000, avg_cost_usd: 0.2 });
    expect(list.find((e) => e.agent_id === A2)).toMatchObject({ sample_size: 0, avg_duration_ms: null, avg_cost_usd: null });
  });

  it('uses the latest 10 done runs only, ignoring failed ones', async () => {
    for (let i = 0; i < 12; i++) {
      agentRuns.push({
        workspaceId: WS, agentId: A1, status: 'done', durationMs: 1000 * (i + 1),
        costUsd: i === 11 ? null : 0.1, ranAt: new Date(T0.getTime() - i * 1000), // i=0 newest
      });
    }
    agentRuns.push({ workspaceId: WS, agentId: A1, status: 'failed', durationMs: 999999, costUsd: 50, ranAt: T0 });
    const app = await setup();
    const res = await app.inject({ method: 'GET', url: '/multi-agent/estimates' });
    const est = AgentRunEstimate.array().parse(res.json()).find((e) => e.agent_id === A1)!;
    expect(est.sample_size).toBe(10);
    expect(est.avg_duration_ms).toBe(5500);
    expect(est.avg_cost_usd).toBeCloseTo(0.1, 10);
  });
});
