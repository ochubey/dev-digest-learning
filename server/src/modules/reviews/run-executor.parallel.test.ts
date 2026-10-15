import { describe, it, expect, vi, beforeEach } from 'vitest';

const detailed = vi.fn();
const reviewPullRequest = vi.fn();
const loadDiff = vi.fn();
vi.mock('../intent/service.js', () => ({
  IntentService: class {
    deriveIntentDetailed = detailed;
  },
}));
vi.mock('../settings/feature-models.js', () => ({
  resolveFeatureModel: async () => ({ provider: 'openrouter', model: 'flash' }),
}));
vi.mock('./diff-loader.js', () => ({ loadDiff: (...a: unknown[]) => loadDiff(...a) }));
vi.mock('@devdigest/reviewer-core', async (orig) => ({
  ...(await orig<typeof import('@devdigest/reviewer-core')>()),
  reviewPullRequest: (...a: unknown[]) => reviewPullRequest(...a),
}));

import { ReviewRunExecutor } from './run-executor.js';

const INTENT = { summary: 'S', in_scope: ['a'], out_of_scope: [], confidence: 0.8, sources: [], missing_context: [] };

const finding = {
  id: 'f1', severity: 'WARNING', category: 'bug', title: 't', file: 'a.ts', start_line: 1, end_line: 1,
  rationale: 'r', confidence: 0.9, kind: 'finding', scope: 'in', scope_reason: 'r',
};

function outcome() {
  return {
    review: { verdict: 'comment', summary: 's', score: 90, findings: [finding] },
    allFindings: [finding],
    scope: {
      total: 1, in: 1, out: 0, signal: 0, hidden: 0, collapsed: 0,
      modelHints: { in: 1, out: 0, signal: 0, invalid: 0 },
      overrides: { criticalChanged: 0, security: 0, secretKind: 0, invalid: 0 },
      overridesTotal: 0, guardTripped: false, active: true,
    },
    llmCalls: 1,
    assembly: { system: '', skills: null, memory: null, specs: null, user: 'u' },
    chunks: [{ label: 'all' }],
    mode: 'single-pass',
    raw: 'raw',
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0.1,
    grounding: '1/1 passed',
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(n = 3) {
  const bus = {
    publish: vi.fn(),
    buffer: () => [],
    complete: vi.fn(),
    isCancelled: () => false,
  };
  const container = {
    runBus: bus,
    github: async () => ({}),
    llm: async () => ({}),
    repoIntel: {
      getCallerSignatures: async () => [],
      getRepoMap: async () => ({ degraded: true, text: '', tokens: 0, cached: false }),
      getFileRank: async () => [],
    },
  };
  const reviewRepo = {
    getPrFiles: async () => [],
    insertReview: vi.fn(async () => ({ id: 'rev' })),
    insertFindings: vi.fn(async (_id: string, fs: unknown[]) => fs),
    markReviewed: vi.fn(async (..._a: unknown[]) => undefined),
    completeAgentRun: vi.fn(async (..._a: unknown[]) => undefined),
    saveRunTrace: vi.fn(async (..._a: unknown[]) => undefined),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const exec = new ReviewRunExecutor(container as never, reviewRepo as never, { linkedSkills: async () => [] } as never);
  const agents = Array.from({ length: n }, (_, i) => ({
    id: `ag${i + 1}`, name: `Agent ${i + 1}`, provider: 'openai', model: 'm', systemPrompt: 'sp', ciFailOn: 'critical', version: 1,
  }));
  const jobs = agents.map((agent, i) => ({ agent: agent as never, runId: `run${i + 1}` }));
  const run = () =>
    exec.executeRuns(
      'ws',
      { id: 'pr1', number: 1, title: 't', author: 'x', headSha: 'h', repoId: 'r' } as never,
      { owner: 'o', name: 'r' } as never,
      jobs,
      logger,
    );
  return { run, reviewRepo, bus };
}

const completion = (repo: { completeAgentRun: { mock: { calls: unknown[][] } } }, runId: string) =>
  repo.completeAgentRun.mock.calls.find((c) => c[0] === runId)?.[1] as { status: string; error?: string | null } | undefined;

describe('ReviewRunExecutor parallel agents', () => {
  beforeEach(() => {
    detailed.mockReset();
    reviewPullRequest.mockReset();
    loadDiff.mockReset();
    loadDiff.mockResolvedValue({ files: [{ path: 'a.ts' }] });
    detailed.mockResolvedValue({ status: 'derived', intent: INTENT, attempts: 1 });
  });

  it('3 agents: loadDiff once, intent derivation at most once', async () => {
    reviewPullRequest.mockResolvedValue(outcome());
    const { run } = setup(3);
    await run();
    expect(loadDiff).toHaveBeenCalledTimes(1);
    expect(detailed.mock.calls.length).toBeLessThanOrEqual(1);
    expect(reviewPullRequest).toHaveBeenCalledTimes(3);
  });

  it('deferred LLM: all 3 reviewPullRequest calls started before any resolves', async () => {
    const gates = [deferred<ReturnType<typeof outcome>>(), deferred<ReturnType<typeof outcome>>(), deferred<ReturnType<typeof outcome>>()];
    let i = 0;
    reviewPullRequest.mockImplementation(() => gates[i++]!.promise);
    const { run, reviewRepo } = setup(3);
    const finished = run();

    for (let k = 0; k < 50 && reviewPullRequest.mock.calls.length < 3; k++) await tick();
    // Nothing has resolved yet, yet all three are in flight.
    expect(reviewPullRequest).toHaveBeenCalledTimes(3);
    expect(reviewRepo.completeAgentRun).not.toHaveBeenCalled();

    gates.forEach((g) => g.resolve(outcome()));
    await finished;
    expect(reviewRepo.completeAgentRun).toHaveBeenCalledTimes(3);
  });

  it('agent 2 of 3 throws: agents 1 and 3 done with persisted reviews, agent 2 failed with its error', async () => {
    let call = 0;
    reviewPullRequest.mockImplementation(async () => {
      const mine = ++call;
      await tick();
      if (mine === 2) throw new Error('LLM exploded');
      return outcome();
    });
    const { run, reviewRepo } = setup(3);
    await expect(run()).resolves.toBeUndefined();

    const statuses = ['run1', 'run2', 'run3'].map((id) => completion(reviewRepo, id));
    const failedIdx = statuses.findIndex((s) => s?.status === 'failed');
    expect(failedIdx).toBeGreaterThanOrEqual(0);
    expect(statuses.filter((s) => s?.status === 'done')).toHaveLength(2);
    expect(statuses[failedIdx]!.error).toContain('LLM exploded');
    // two reviews persisted (the two surviving agents)
    expect(reviewRepo.insertReview).toHaveBeenCalledTimes(2);
  });

  it('diff loader fails: every child failed with the same error', async () => {
    loadDiff.mockRejectedValue(new Error('no diff for you'));
    const { run, reviewRepo } = setup(3);
    await run();
    expect(reviewPullRequest).not.toHaveBeenCalled();
    const errors = ['run1', 'run2', 'run3'].map((id) => completion(reviewRepo, id));
    expect(errors.every((e) => e?.status === 'failed')).toBe(true);
    expect(new Set(errors.map((e) => e!.error)).size).toBe(1);
    expect(errors[0]!.error).toContain('no diff for you');
  });
});
