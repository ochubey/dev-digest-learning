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

function setup(n = 3, reviewRunTimeoutMs?: number) {
  const bus = {
    publish: vi.fn(),
    buffer: () => [],
    complete: vi.fn(),
    isCancelled: () => false,
  };
  const container = {
    ...(reviewRunTimeoutMs ? { config: { reviewRunTimeoutMs } } : {}),
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


describe('ReviewRunExecutor per-run deadline', () => {
  beforeEach(() => {
    detailed.mockReset();
    reviewPullRequest.mockReset();
    loadDiff.mockReset();
    loadDiff.mockResolvedValue({ files: [{ path: 'a.ts' }] });
    detailed.mockResolvedValue({ status: 'derived', intent: INTENT, attempts: 1 });
  });

  it('a hung LLM call fails only that run with the timeout message; the others finish done', async () => {
    let call = 0;
    reviewPullRequest.mockImplementation(() => (++call === 2 ? new Promise(() => undefined) : Promise.resolve(outcome())));
    const { run, reviewRepo, bus } = setup(3, 50);
    await run();

    expect(completion(reviewRepo, 'run1')?.status).toBe('done');
    expect(completion(reviewRepo, 'run3')?.status).toBe('done');
    expect(completion(reviewRepo, 'run2')).toMatchObject({
      status: 'failed',
      error: 'Run timed out after 0s (no response from the model)',
    });
    expect(reviewRepo.saveRunTrace.mock.calls.some((c) => c[0] === 'run2')).toBe(true);
    expect(bus.complete).toHaveBeenCalledWith('run2');
    expect(reviewRepo.insertReview).toHaveBeenCalledTimes(2);
  });

  it('reports whole seconds in the message', async () => {
    reviewPullRequest.mockImplementation(() => new Promise(() => undefined));
    vi.useFakeTimers();
    try {
      const { run, reviewRepo } = setup(1, 300_000);
      const p = run();
      await vi.advanceTimersByTimeAsync(300_000);
      await p;
      expect(completion(reviewRepo, 'run1')?.error).toBe('Run timed out after 300s (no response from the model)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late resolution after the timeout persists nothing and does not flip the status', async () => {
    const gate = deferred<ReturnType<typeof outcome>>();
    reviewPullRequest.mockImplementation(() => gate.promise);
    const { run, reviewRepo } = setup(1, 30);
    await run();
    expect(completion(reviewRepo, 'run1')?.status).toBe('failed');

    gate.resolve(outcome());
    for (let k = 0; k < 5; k++) await tick();
    expect(reviewRepo.insertReview).not.toHaveBeenCalled();
    expect(reviewRepo.insertFindings).not.toHaveBeenCalled();
    expect(reviewRepo.completeAgentRun).toHaveBeenCalledTimes(1);
  });

  it('a late rejection after the timeout is swallowed', async () => {
    const gate = deferred<ReturnType<typeof outcome>>();
    reviewPullRequest.mockImplementation(() => gate.promise);
    const { run, reviewRepo } = setup(1, 30);
    await run();
    gate.reject(new Error('late boom'));
    for (let k = 0; k < 5; k++) await tick();
    expect(reviewRepo.completeAgentRun).toHaveBeenCalledTimes(1);
  });

  it('defaults to 300000 ms when the container has no config value', async () => {
    reviewPullRequest.mockImplementation(() => new Promise(() => undefined));
    vi.useFakeTimers();
    try {
      const { run, reviewRepo } = setup(1);
      const p = run();
      await vi.advanceTimersByTimeAsync(299_000);
      expect(reviewRepo.completeAgentRun).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      await p;
      expect(completion(reviewRepo, 'run1')?.status).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });
});
