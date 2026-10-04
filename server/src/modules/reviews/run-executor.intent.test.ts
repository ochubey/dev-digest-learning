import { describe, it, expect, vi, beforeEach } from 'vitest';

const detailed = vi.fn();
vi.mock('../intent/service.js', () => ({
  IntentService: class {
    deriveIntentDetailed = detailed;
  },
}));
vi.mock('../settings/feature-models.js', () => ({
  resolveFeatureModel: async () => ({ provider: 'openrouter', model: 'flash' }),
}));

import { ReviewRunExecutor } from './run-executor.js';

const pull = { id: 'pr1' } as never;
const repo = { owner: 'o', name: 'r' } as never;
// The diff the run loaded (the pr_files table is intentionally EMPTY in these tests).
const diff = {
  raw: '',
  files: [
    {
      path: 'src/a.ts',
      additions: 1,
      deletions: 0,
      hunks: [{ file: 'src/a.ts', oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, newLineNumbers: [1] }],
    },
    { path: 'src/b.ts', additions: 0, deletions: 1, hunks: [] },
  ],
} as never;

function setup() {
  const container = { github: async () => ({}) } as never;
  const reviewRepo = { getPrFiles: async () => [] } as never;
  const exec = new ReviewRunExecutor(container, reviewRepo, {} as never);
  const runLog = { info: vi.fn(), error: vi.fn(), step: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const call = () =>
    (
      exec as unknown as {
        deriveIntent: (p: unknown) => Promise<{ intent?: unknown; status: string; attempts: number }>;
      }
    ).deriveIntent({ workspaceId: 'ws', pull, repo, diff, runLog, correlationId: 'corr', logger });
  return { call, runLog, logger, exec };
}

const INTENT = { summary: 'S', in_scope: ['a'], out_of_scope: ['b'], confidence: 0.5, sources: [], missing_context: [] };

describe('ReviewRunExecutor.deriveIntent', () => {
  beforeEach(() => {
    detailed.mockReset();
  });

  it('failed derive: emits an error to runLog, returns a failed outcome, does not throw', async () => {
    detailed.mockResolvedValue({ status: 'failed', error: 'llm boom', attempts: 0 });
    const { call, runLog } = setup();
    await expect(call()).resolves.toEqual({ status: 'failed', attempts: 0 });
    expect(runLog.error).toHaveBeenCalledTimes(1);
    expect(runLog.error.mock.calls[0]![0]).toContain('llm boom');
    // load + resolve_refs are logged regardless of outcome (no meta -> "not reached")
    expect(lines(runLog.info)).toEqual([
      'intent.load: not reached (llm boom)',
      'intent.resolve_refs: not reached (llm boom)',
    ]);
  });

  it('unexpected throw is fail-open and still reaches runLog + pino', async () => {
    detailed.mockImplementation(async () => {
      throw new Error('kaput');
    });
    const { call, runLog, logger } = setup();
    await expect(call()).resolves.toEqual({ status: 'failed', attempts: 0 });
    expect(runLog.error.mock.calls[0]![0]).toContain('kaput');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('logs a distinct message for cache hit vs LLM derive', async () => {
    detailed.mockResolvedValueOnce({ status: 'cached', intent: INTENT, attempts: 0 });
    const a = setup();
    const cachedIntent = await a.call();
    expect(cachedIntent).toEqual({ intent: INTENT, status: 'cached', attempts: 0 });
    expect(lines(a.runLog.info).find((l) => l.startsWith('intent.derive'))).toContain('cache hit');

    detailed.mockResolvedValueOnce({ status: 'derived', intent: INTENT, attempts: 2 });
    const b = setup();
    expect(await b.call()).toEqual({ intent: INTENT, status: 'derived', attempts: 2 });
    expect(lines(b.runLog.info).find((l) => l.startsWith('intent.derive'))).toContain('derived via LLM');
    expect(b.runLog.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runLog lines (Live Log): load / resolve_refs / derive details
// ---------------------------------------------------------------------------
const PROMPT = {
  files: 3,
  filesIncluded: 3,
  hunkHeaders: 4,
  bodyChars: 120,
  bodyTruncated: false,
  refs: ['linked issue', 'plan docs/plan.md'],
  unavailableRefs: 1,
  promptChars: 4000,
};
const META = {
  cache: 'miss',
  model: 'openrouter/flash',
  tokensIn: 1000,
  tokensOut: 200,
  tokens: 1200,
  costUsd: 0.0021,
  estPromptTokens: 1000,
  prompt: PROMPT,
  refStatuses: {},
  refSources: [
    { label: 'Linked issue #12', status: 'fetched' },
    { label: 'Plan at docs/plan.md', status: 'unavailable' },
    { label: 'Issue a/b#3 (other repository)', status: 'error' },
  ],
  sources: [],
  warnings: [] as string[],
};
const lines = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.map((c) => String(c[0]));

describe('ReviewRunExecutor.deriveIntent run-log details', () => {
  beforeEach(() => detailed.mockReset());

  it('derived: logs load miss, resolved refs, model/provider, prompt composition, est + actual tokens, cost', async () => {
    detailed.mockResolvedValue({ status: 'derived', intent: INTENT, attempts: 1, meta: META });
    const { call, runLog } = setup();
    await call();
    const out = lines(runLog.info);
    expect(out.find((l) => l.startsWith('intent.load'))).toMatch(/cache miss/);
    const refs = out.find((l) => l.startsWith('intent.resolve_refs'))!;
    expect(refs).toMatch(/Linked issue #12: found/);
    expect(refs).toMatch(/Plan at docs\/plan\.md: not_found/);
    expect(refs).toMatch(/\(other repository\): error/);
    const derive = out.find((l) => l.startsWith('intent.derive'))!;
    expect(derive).toMatch(/provider=openrouter/);
    expect(derive).toMatch(/model=openrouter\/flash/);
    expect(derive).toMatch(/files=3/);
    expect(derive).toMatch(/hunk_headers=4/);
    expect(derive).toMatch(/body_chars=120/);
    expect(derive).toMatch(/refs=\[linked issue, plan docs\/plan\.md\]/);
    expect(derive).toMatch(/body_truncated=no/);
    expect(derive).toMatch(/est_prompt_tokens=~1000/);
    expect(derive).toMatch(/tokens_in=1000/);
    expect(derive).toMatch(/tokens_out=200/);
    expect(derive).toMatch(/cost_usd=\$0\.0021/);
    // every line carries its step for filtering
    expect(runLog.info.mock.calls.map((c) => (c[1] as { step: string }).step)).toEqual([
      'intent.load',
      'intent.resolve_refs',
      'intent.derive',
      'intent.inject',
    ]);
  });

  it('cost unknown is stated, not hidden', async () => {
    detailed.mockResolvedValue({
      status: 'derived',
      intent: INTENT,
      attempts: 1,
      meta: { ...META, costUsd: null },
    });
    const { call, runLog } = setup();
    await call();
    expect(lines(runLog.info).join('\n')).toMatch(/cost_usd=unknown/);
  });

  it('fallback + prompt-cap warnings are written to runLog (step intent.derive), not only pino', async () => {
    detailed.mockResolvedValue({
      status: 'derived',
      intent: INTENT,
      attempts: 1,
      meta: {
        ...META,
        model: 'anthropic/main',
        fallbackFrom: 'openrouter/flash',
        warnings: ['review_intent model openrouter/flash unavailable (no key); falling back to main review model anthropic/main', 'PR has 120 files (>= 100)'],
      },
    });
    const { call, runLog, logger } = setup();
    await call();
    const warn = runLog.info.mock.calls.filter((c) => String(c[0]).includes('warning'));
    expect(warn).toHaveLength(2);
    expect(String(warn[0]![0])).toMatch(/falling back to main review model anthropic\/main/);
    expect((warn[0]![1] as { step: string }).step).toBe('intent.derive');
    expect(logger.warn).toHaveBeenCalled();
    expect(lines(runLog.info).find((l) => l.startsWith('intent.derive:'))).toMatch(
      /fell back from openrouter\/flash/,
    );
  });

  it('cached: logs load hit + refs + a cache-hit derive line (no tokens/cost)', async () => {
    detailed.mockResolvedValue({
      status: 'cached',
      intent: INTENT,
      attempts: 0,
      meta: { ...META, cache: 'hit', model: undefined, prompt: undefined, tokens: undefined, costUsd: undefined },
    });
    const { call, runLog } = setup();
    await call();
    const out = lines(runLog.info);
    expect(out.find((l) => l.startsWith('intent.load'))).toMatch(/cache hit/);
    expect(out.find((l) => l.startsWith('intent.resolve_refs'))).toMatch(/found/);
    const derive = out.find((l) => l.startsWith('intent.derive'))!;
    expect(derive).toMatch(/cache hit \(no LLM call\)/);
    expect(derive).not.toMatch(/tokens_in/);
  });

  it('failed: error line states the cause; refs resolved before the failure are still logged', async () => {
    detailed.mockResolvedValue({
      status: 'failed',
      error: 'llm boom',
      attempts: 0,
      meta: { ...META, warnings: ['x'] },
    });
    const { call, runLog } = setup();
    await call();
    expect(lines(runLog.error)[0]).toMatch(/llm boom/);
    expect(lines(runLog.info).find((l) => l.startsWith('intent.resolve_refs'))).toBeDefined();
  });

  it('passes the main review model (first agent) as the fallback', async () => {
    detailed.mockResolvedValue({ status: 'cached', intent: INTENT, attempts: 0 });
    const { exec, runLog } = setup();
    await (exec as unknown as { deriveIntent: (p: unknown) => Promise<unknown> }).deriveIntent({
      workspaceId: 'ws',
      pull,
      repo,
      diff,
      runLog,
      correlationId: 'c',
      fallback: { provider: 'anthropic', model: 'main' },
    });
    expect(detailed.mock.calls[0]![5]).toEqual({ reuseIfSameHead: true, fallback: { provider: 'anthropic', model: 'main' }, onLlmCall: expect.any(Function) });
  });
});

describe('ReviewRunExecutor.deriveIntent: files + hunk headers come from the loaded diff', () => {
  beforeEach(() => detailed.mockReset());

  it('passes the diff files (not pr_files, which is empty) to the intent service', async () => {
    detailed.mockResolvedValue({ status: 'cached', intent: INTENT, attempts: 0 });
    const { call } = setup();
    await call();
    const files = detailed.mock.calls[0]![2] as Array<{ path: string; patch?: string }>;
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(files[0]!.patch).toBe('@@ -1,2 +1,3 @@');
  });

  it('prompt stats from the real prompt builder see files > 0 with an empty pr_files', async () => {
    const { assembleIntentPrompt } = await import('@devdigest/reviewer-core');
    detailed.mockResolvedValue({ status: 'cached', intent: INTENT, attempts: 0 });
    const { call } = setup();
    await call();
    const files = detailed.mock.calls[0]![2] as Array<{ path: string; patch?: string }>;
    const { stats } = assembleIntentPrompt({ title: 't', body: 'b', files });
    expect(stats.files).toBeGreaterThan(0);
    expect(stats.filesIncluded).toBeGreaterThan(0);
    expect(stats.hunkHeaders).toBeGreaterThan(0);
  });
});

describe('ReviewRunExecutor.deriveIntent: load/resolve_refs logged on failure + ASCII', () => {
  beforeEach(() => detailed.mockReset());

  it('failed with meta: still logs load and the resolved refs', async () => {
    detailed.mockResolvedValue({
      status: 'failed',
      error: 'llm boom',
      attempts: 1,
      meta: { ...META, cache: 'bypass' },
    });
    const { call, runLog } = setup();
    await call();
    expect(lines(runLog.info)).toEqual([
      'intent.load: cache bypassed (force)',
      expect.stringMatching(/^intent\.resolve_refs: Linked issue #12: found/),
    ]);
  });

  it('failed before refs: resolve_refs says not reached (reason)', async () => {
    detailed.mockResolvedValue({
      status: 'failed',
      error: 'gh down',
      attempts: 0,
      meta: { ...META, cache: 'not_reached', refsReached: false, refSources: [] },
    });
    const { call, runLog } = setup();
    await call();
    expect(lines(runLog.info)).toEqual([
      'intent.load: not reached (gh down)',
      'intent.resolve_refs: not reached (gh down)',
    ]);
  });

  it('all intent.* run-log lines are ASCII-only', async () => {
    const ASCII = /^[\x00-\x7F]*$/;
    const all: string[] = [];
    for (const res of [
      { status: 'derived', intent: INTENT, attempts: 1, meta: { ...META, warnings: ['w'] } },
      { status: 'cached', intent: { ...INTENT, confidence: 0.3 }, attempts: 0, meta: { ...META, cache: 'hit' } },
      { status: 'cached', intent: { ...INTENT, confidence: 0 }, attempts: 0, meta: { ...META, cache: 'hit' } },
      { status: 'failed', error: 'x — y', attempts: 0 },
    ]) {
      detailed.mockResolvedValueOnce(res);
      const { call, runLog } = setup();
      await call();
      all.push(...lines(runLog.info).filter((l) => l.startsWith('intent.')));
    }
    expect(all.length).toBeGreaterThan(8);
    for (const l of all) expect(l).toMatch(ASCII);
  });

  it('confidence 0 / low confidence: one explanatory line each', async () => {
    detailed.mockResolvedValueOnce({ status: 'derived', intent: { ...INTENT, confidence: 0 }, attempts: 1, meta: META });
    const a = setup();
    await a.call();
    expect(lines(a.runLog.info).find((l) => l.startsWith('intent.skip:'))).toMatch(/confidence=0 .*omitted/);

    detailed.mockResolvedValueOnce({ status: 'derived', intent: { ...INTENT, confidence: 0.3 }, attempts: 1, meta: META });
    const b = setup();
    await b.call();
    const low = lines(b.runLog.info).find((l) => l.startsWith('intent.low_confidence:'))!;
    expect(low).toMatch(/0\.30/);
    expect(low).toMatch(/scope filter inactive/);
  });
});

describe('ReviewRunExecutor.deriveIntent: Live Log narrative', () => {
  beforeEach(() => detailed.mockReset());

  it('wraps the derive in a tool step and logs input size, model call and injection', async () => {
    const seen: unknown[][] = [];
    detailed.mockImplementation(async (...args: unknown[]) => {
      seen.push(args);
      const opts = args[5] as { onLlmCall?: (i: unknown) => void } | undefined;
      opts?.onLlmCall?.({ provider: 'openrouter', model: 'flash', estPromptTokens: 3403 });
      return { status: 'derived', intent: INTENT, attempts: 1, meta: META };
    });
    const { call, runLog } = setup();
    await call();
    expect(seen.map((a) => a.length)).toEqual([6]);
    expect(runLog.step.mock.calls[0]![0]).toBe('Deriving PR intent');
    expect(runLog.step.mock.calls[0]![2]).toEqual({ kind: 'tool' });
    const out = lines(runLog.info);
    expect(out).toContain('Intent input: ~3403 est. tokens (vs ~0 for full diff)');
    expect(out).toContain('Intent: calling openrouter/flash');
    expect(out).toContain('Intent derived — injecting into review prompt');
  });

  it('a reused intent says so instead of "derived"', async () => {
    detailed.mockResolvedValue({ status: 'cached', intent: INTENT, attempts: 0, meta: { ...META, cache: 'hit', reused: true } });
    const { call, runLog } = setup();
    await call();
    expect(lines(runLog.info)).toContain('Intent reused (head SHA unchanged) — injecting into review prompt');
  });
});
