import { describe, it, expect, vi, beforeEach } from 'vitest';

const detailed = vi.fn();
const reviewPullRequest = vi.fn();
vi.mock('../intent/service.js', () => ({
  IntentService: class {
    deriveIntentDetailed = detailed;
  },
}));
vi.mock('../settings/feature-models.js', () => ({
  resolveFeatureModel: async () => ({ provider: 'openrouter', model: 'flash' }),
}));
vi.mock('./diff-loader.js', () => ({ loadDiff: async () => ({ files: [{ path: 'a.ts' }] }) }));
vi.mock('@devdigest/reviewer-core', async (orig) => ({
  ...(await orig<typeof import('@devdigest/reviewer-core')>()),
  reviewPullRequest: (...a: unknown[]) => reviewPullRequest(...a),
}));

import { ReviewRunExecutor } from './run-executor.js';

const INTENT = { summary: 'S', in_scope: ['a'], out_of_scope: ['b'], confidence: 0.8, sources: [], missing_context: [] };

const f = (id: string, severity: string, scope: 'in' | 'out' | 'signal') => ({
  id,
  severity,
  category: 'bug',
  title: id,
  file: 'a.ts',
  start_line: 1,
  end_line: 1,
  rationale: 'r',
  confidence: 0.9,
  kind: 'finding',
  scope,
  scope_reason: `${scope}-reason`,
});

const IN = f('in1', 'WARNING', 'in');
const OUT = f('out1', 'CRITICAL', 'out');
const SIG = f('sig1', 'CRITICAL', 'signal');

function outcome(llmCalls = 1) {
  return {
    review: { verdict: 'comment', summary: 's', score: 90, findings: [IN] },
    allFindings: [IN, OUT, SIG],
    scope: {
      total: 3, in: 1, out: 1, signal: 1, hidden: 1, collapsed: 1,
      modelHints: { in: 1, out: 1, signal: 1, invalid: 0 },
      overrides: { criticalChanged: 1, security: 0, secretKind: 0, invalid: 0 },
      overridesTotal: 1,
      guardTripped: false, active: true,
    },
    llmCalls,
    assembly: { system: '', skills: null, memory: null, specs: null, user: 'u' },
    chunks: [{ label: 'all' }],
    mode: 'single-pass',
    raw: 'raw',
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0.1,
    grounding: '3/3 passed',
  };
}

function setup() {
  const events: { kind: string; msg: string }[] = [];
  const bus = {
    publish: (_id: string, kind: string, msg: string) => events.push({ kind, msg }),
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
    insertReview: vi.fn(async () => ({ id: 'rev1' })),
    insertFindings: vi.fn(async (_id: string, fs: unknown[]) => fs),
    markReviewed: vi.fn(),
    completeAgentRun: vi.fn(),
    saveRunTrace: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const exec = new ReviewRunExecutor(
    container as never,
    reviewRepo as never,
    { linkedSkills: async () => [] } as never, // agents service: no skills linked
  );
  const agent = { id: 'ag', name: 'A', provider: 'openai', model: 'm', systemPrompt: 'sp', ciFailOn: 'critical', version: 1 };
  const run = () =>
    exec.executeRuns('ws', { id: 'pr1', number: 1, title: 't', author: 'x', headSha: 'h', repoId: 'r' } as never,
      { owner: 'o', name: 'r' } as never, [{ agent: agent as never, runId: 'run1' }], logger);
  return { run, events, reviewRepo, logger };
}

describe('ReviewRunExecutor scope wiring', () => {
  beforeEach(() => {
    detailed.mockReset();
    reviewPullRequest.mockReset();
  });

  it('passes intentObj, persists allFindings, counts only scope=in, logs scope.apply + llm.calls', async () => {
    detailed.mockResolvedValue({ status: 'derived', intent: INTENT, attempts: 1 });
    reviewPullRequest.mockResolvedValue(outcome(1));
    const { run, events, reviewRepo, logger } = setup();
    await run();

    const input = reviewPullRequest.mock.calls[0]![0] as { intentObj?: unknown; intent?: unknown };
    expect(input.intentObj).toEqual(INTENT);
    expect(input.intent).toBeUndefined();

    expect(reviewRepo.insertFindings).toHaveBeenCalledWith('rev1', [IN, OUT, SIG]);
    const done = reviewRepo.completeAgentRun.mock.calls[0]![1] as Record<string, unknown>;
    expect(done.status).toBe('done');
    expect(done.findingsCount).toBe(1);
    expect(done.blockers).toBe(0); // only the WARNING 'in' finding counts
    expect(done.severityCounts).toEqual({ critical: 0, warning: 1, suggestion: 0 });

    // ONE human scope line (the engine's `Scope policy:` event) — the executor adds
    // only structured pino meta for scope.apply, never a second runLog line.
    expect(events.some((e) => e.msg.startsWith('scope.apply'))).toBe(false);
    expect(events.some((e) => e.msg === 'llm.calls: intent=1 ok review=1')).toBe(true);
    const meta = logger.info.mock.calls.find((c) => String(c[1]) === 'scope.apply')?.[0] as {
      step?: string;
      correlationId?: string;
      overridesTotal?: number;
      in?: number;
      guardTripped?: boolean;
    };
    expect(meta.step).toBe('scope.apply');
    expect(meta.correlationId).toBeTruthy();
    expect(meta).toMatchObject({ in: 1, overridesTotal: 1, guardTripped: false });
  });

  it('llm.calls reports the real intent attempts (reprompts included)', async () => {
    detailed.mockResolvedValue({ status: 'derived', intent: INTENT, attempts: 3 });
    reviewPullRequest.mockResolvedValue(outcome(1));
    const { run, events } = setup();
    await run();
    expect(events.some((e) => e.msg === 'llm.calls: intent=3 (retried, 3 attempts) ok review=1')).toBe(true);
  });

  it('llm.calls reports intent=0 cached and intent=0 failed', async () => {
    detailed.mockResolvedValue({ status: 'cached', intent: INTENT, attempts: 0 });
    reviewPullRequest.mockResolvedValue(outcome(2));
    const a = setup();
    await a.run();
    expect(a.events.some((e) => e.msg === 'llm.calls: intent=0 cached review=2')).toBe(true);

    // failed before any LLM call -> skipped; failed after one HTTP attempt -> 1 failed
    detailed.mockResolvedValue({ status: 'failed', error: 'boom', attempts: 0 });
    const b = setup();
    await b.run();
    expect(b.events.some((e) => e.msg === 'llm.calls: intent=0 skipped review=2')).toBe(true);

    detailed.mockResolvedValue({ status: 'failed', error: 'boom', attempts: 1 });
    const c = setup();
    await c.run();
    expect(c.events.some((e) => e.msg === 'llm.calls: intent=1 failed review=2')).toBe(true);
  });

  it('confidence 0: no intentObj reaches the review (no Intent section / scope instructions), intent.skip logged', async () => {
    detailed.mockResolvedValue({ status: 'derived', intent: { ...INTENT, confidence: 0 }, attempts: 1 });
    reviewPullRequest.mockResolvedValue(outcome(1));
    const { run, events } = setup();
    await run();
    const input = reviewPullRequest.mock.calls[0]![0] as { intentObj?: unknown };
    expect(input.intentObj).toBeUndefined();
    expect(events.some((e) => e.msg.startsWith('intent.skip: confidence=0'))).toBe(true);
  });

  it('0 < confidence < 0.5: intentObj IS passed (marked weak by reviewer-core), low-confidence line logged', async () => {
    const weak = { ...INTENT, confidence: 0.3 };
    detailed.mockResolvedValue({ status: 'derived', intent: weak, attempts: 1 });
    reviewPullRequest.mockResolvedValue(outcome(1));
    const { run, events } = setup();
    await run();
    const input = reviewPullRequest.mock.calls[0]![0] as { intentObj?: unknown };
    expect(input.intentObj).toEqual(weak);
    expect(
      events.some((e) => e.msg.startsWith('intent.low_confidence:') && e.msg.includes('scope filter inactive')),
    ).toBe(true);
  });

  it('llm.calls line is ASCII-only in every state', async () => {
    for (const r of [
      { status: 'derived', intent: INTENT, attempts: 2 },
      { status: 'cached', intent: INTENT, attempts: 0 },
      { status: 'failed', error: 'e', attempts: 0 },
      { status: 'failed', error: 'e', attempts: 1 },
    ]) {
      detailed.mockResolvedValue(r);
      reviewPullRequest.mockResolvedValue(outcome(1));
      const { run, events } = setup();
      await run();
      const l = events.find((e) => e.msg.startsWith('llm.calls:'))!.msg;
      expect(l).toMatch(/^[\x00-\x7F]*$/);
    }
  });

  it('fail-open: intent failure still reviews, without intentObj', async () => {
    detailed.mockResolvedValue({ status: 'failed', error: 'boom', attempts: 0 });
    reviewPullRequest.mockResolvedValue(outcome(1));
    const { run, reviewRepo } = setup();
    await run();
    const input = reviewPullRequest.mock.calls[0]![0] as { intentObj?: unknown };
    expect(input.intentObj).toBeUndefined();
    expect((reviewRepo.completeAgentRun.mock.calls[0]![1] as { status: string }).status).toBe('done');
  });
});
