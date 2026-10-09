/**
 * BriefService with stub repos, a MockLLMProvider spy, a repoIntel stub and a MockGitHubClient.
 * No DB: the intent/brief repositories and the diff loader are injected.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// The brief must never derive Intent: constructing the service is a test failure.
vi.mock('../src/modules/intent/service.js', () => ({
  IntentService: class {
    constructor() {
      throw new Error('IntentService must not be constructed by the brief');
    }
  },
}));

import { MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { BriefService, trimBlast, type BriefServiceOptions } from '../src/modules/brief/service.js';
import { PrBriefStored } from '../src/modules/brief/schema.js';
import { ConfigError, ExternalServiceError } from '../src/platform/errors.js';
import type { DiffLoadResult } from '../src/modules/blast/files.js';

const SENTINEL = 'SPEC-SENTINEL-9f3a';

const pr = (over: Record<string, unknown> = {}) =>
  ({
    id: 'pr1',
    workspaceId: 'ws',
    repoId: 'repo1',
    title: 'Add thing',
    body: 'Adds the thing.',
    headSha: 'sha-1',
    ...over,
  }) as never;
const repo = { id: 'repo1', owner: 'o', name: 'r' };
const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never;

const loaded = (paths: string[] = ['src/a.ts']): DiffLoadResult => ({
  status: 'loaded',
  diff: {
    raw: '',
    files: paths.map((path) => ({
      path,
      additions: 3,
      deletions: 1,
      hunks: [{ file: path, oldStart: 1, oldLines: 1, newStart: 10, newLines: 5, newLineNumbers: [] }],
    })),
  } as never,
});

const OUTPUT = {
  summary: 'It adds the thing.',
  risks: [
    {
      kind: 'correctness',
      title: 'Edge case',
      explanation: 'Might break.',
      severity: 'high',
      file_refs: ['src/a.ts', 'invented/nope.ts'],
      anchor_file: null,
      anchor_start_line: null,
      anchor_end_line: null,
    },
    {
      kind: 'other',
      title: 'Invented',
      explanation: 'x',
      severity: 'low',
      file_refs: ['invented/only.ts'],
      anchor_file: null,
      anchor_start_line: null,
      anchor_end_line: null,
    },
  ],
  review_focus: [
    { file: 'src/a.ts', line: 12, reason: 'core' },
    { file: 'invented/nope.ts', line: 1, reason: 'bad' },
  ],
};

const intentRow = {
  summary: 'Intent S',
  inScope: ['a'],
  outOfScope: ['b'],
  confidence: 0.8,
  sources: [{ label: 'PR title', status: 'fetched' }],
  missingContext: [],
};

const blastResult = {
  changedSymbols: [{ file: 'src/a.ts', name: 'doThing', kind: 'function' }],
  callers: [{ file: 'src/caller.ts', symbol: 'run', viaSymbol: 'doThing', line: 4, rank: 1 }],
  impactedEndpoints: [],
};

function setup(
  over: {
    structured?: unknown;
    intent?: unknown;
    diff?: DiffLoadResult;
    blast?: () => Promise<unknown>;
    github?: MockGitHubClient;
    opts?: BriefServiceOptions;
    llm?: MockLLMProvider;
    pr?: Record<string, unknown>;
  } = {},
) {
  const llm = over.llm ?? new MockLLMProvider('openai', { structured: over.structured ?? OUTPUT });
  const github = over.github ?? new MockGitHubClient();
  const upsertBrief = vi.fn(async () => {});
  const upsertIntent = vi.fn();
  const deriveIntent = vi.fn();
  const getBlastRadius = vi.fn(over.blast ?? (async () => blastResult));
  const container = {
    llm: async () => llm,
    github: async () => github,
    repoIntel: { getBlastRadius },
    db: {},
  } as never;
  const service = new BriefService(container, {
    intentRepo: {
      getIntent: async () => (('intent' in over ? over.intent : intentRow) as never),
      upsertIntent,
      deriveIntent,
    } as never,
    briefRepo: { upsertBrief },
    changedDiff: async () => over.diff ?? loaded(),
    resolveModel: async () => ({ provider: 'openai', model: 'gpt-test' }),
    now: () => new Date('2026-10-09T12:00:00.000Z'),
    ...over.opts,
  });
  const run = () => service.generate({ workspaceId: 'ws', pr: pr(over.pr), repo, log });
  const calls = () => llm.calls.filter((c) => c.method === 'completeStructured');
  return { run, llm, calls, upsertBrief, upsertIntent, deriveIntent, getBlastRadius, github };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BriefService.generate', () => {
  it('makes exactly one completeStructured call with maxRetries 1 and the given model; stores attempts', async () => {
    const s = setup();
    const r = await s.run();
    expect(r.status).toBe('ok');
    expect(s.calls()).toHaveLength(1);
    const req = s.calls()[0]!.req as Record<string, unknown>;
    expect(req).toMatchObject({
      model: 'gpt-test',
      schemaName: 'PrBriefOutput',
      temperature: 0,
      maxRetries: 1,
      timeoutMs: 45_000,
    });
    if (r.status === 'ok') {
      expect(r.brief.meta.schema_attempts).toBe(1);
      expect(r.brief.meta.provider).toBe('openai');
      expect(r.brief.meta.model).toBe('gpt-test');
      expect(r.brief.meta.generated_from_head_sha).toBe('sha-1');
      expect(r.meta).toMatchObject({ outcome: 'ok', calls: 1, schemaAttempts: 1 });
    }
    expect(s.upsertBrief).toHaveBeenCalledTimes(1);
  });

  it('drops invented paths end to end and counts them', async () => {
    const s = setup();
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.risks.risks).toHaveLength(1);
    expect(r.brief.risks.risks[0]!.file_refs).toEqual(['src/a.ts']);
    expect(r.brief.review_focus).toEqual([{ file: 'src/a.ts', line: 12, reason: 'core' }]);
    expect(r.brief.meta.grounding).toEqual({
      dropped_risks: 1,
      dropped_refs: 2,
      dropped_focus: 1,
      adjusted_lines: 0,
      dropped_anchors: 0,
    });
    expect(r.meta.grounding).toEqual(r.brief.meta.grounding);
  });

  it('dropped_anchors mix: clipped, out-of-hunk, partial, all-null and invented-ref risks', async () => {
    const mk = (title: string, refs: string[], a: [string | null, number | null, number | null]) => ({
      kind: 'correctness',
      title,
      explanation: 'x',
      severity: 'low',
      file_refs: refs,
      anchor_file: a[0],
      anchor_start_line: a[1],
      anchor_end_line: a[2],
    });
    // the diff has src/a.ts with new-side range 10-14
    const s = setup({
      structured: {
        summary: 's',
        risks: [
          mk('valid', ['src/a.ts'], ['src/a.ts', 12, 30]),
          mk('outside', ['src/a.ts'], ['src/a.ts', 40, 50]),
          mk('partial', ['src/a.ts'], ['src/a.ts', 12, null]),
          mk('allnull', ['src/a.ts'], [null, null, null]),
          mk('invented', ['invented/x.ts'], ['src/a.ts', 12, 13]),
        ],
        review_focus: [],
      },
    });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.meta.grounding.dropped_anchors).toBe(2);
    expect(r.brief.meta.grounding.dropped_risks).toBe(1);
    expect(r.meta.grounding).toEqual(r.brief.meta.grounding);
    const risks = r.brief.risks.risks;
    expect(risks.map((x) => x.title)).toEqual(['valid', 'outside', 'partial', 'allnull']);
    expect(risks[0]!.anchor).toEqual({ file: 'src/a.ts', start_line: 12, end_line: 14 });
    for (const x of risks.slice(1)) expect(x.anchor).toBeUndefined();
    expect(PrBriefStored.safeParse(r.brief).success).toBe(true);
    const stored = (s.upsertBrief.mock.calls[0] as unknown as [string, unknown])[1];
    expect(JSON.stringify(stored)).not.toContain('anchor_');
  });

  it('no pr_intent: missing includes intent, snapshot is null, intent is never written or derived', async () => {
    const s = setup({ intent: undefined });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.meta.missing).toContain('intent');
    expect(r.brief.intent).toBeNull();
    expect(s.upsertIntent).not.toHaveBeenCalled();
    expect(s.deriveIntent).not.toHaveBeenCalled();
  });

  it('degraded getBlastRadius with 0 symbols: blast missing and the reason is recorded', async () => {
    const s = setup({
      blast: async () => ({
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: true,
        reason: 'no_index',
      }),
    });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.meta.missing).toContain('blast');
    expect(r.brief.blast).toBeNull();
    expect(r.brief.meta.input.blast_degraded_reason).toBe('no_index');
  });

  it('degraded blast WITH symbols keeps the blast and records the reason', async () => {
    const s = setup({ blast: async () => ({ ...blastResult, degraded: true, reason: 'stale_index' }) });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.meta.missing).not.toContain('blast');
    expect(r.brief.blast).not.toBeNull();
    expect(r.brief.meta.input.blast_degraded_reason).toBe('stale_index');
  });

  it('a throwing getBlastRadius is fail-open (blast missing)', async () => {
    const s = setup({
      blast: async () => {
        throw new Error('boom');
      },
    });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.meta.missing).toContain('blast');
  });

  it('a throwing github.getIssue / readRepoFile: generation continues, sources are error', async () => {
    const github = new MockGitHubClient();
    vi.spyOn(github, 'getIssue').mockRejectedValue(new Error('rate limited'));
    vi.spyOn(github, 'readRepoFile').mockRejectedValue(new Error('network'));
    const s = setup({
      github,
      pr: { body: 'Fixes #7. See docs/plan.md for details.' },
    });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    const byLabel = Object.fromEntries(r.brief.meta.sources.map((x) => [x.label, x.status]));
    expect(byLabel['Linked issue #7']).toBe('error');
    expect(byLabel['Plan at docs/plan.md']).toBe('error');
    expect(r.brief.meta.missing).toEqual(expect.arrayContaining(['linked_issue', 'specs']));
  });

  it('GitHub not configured: referenced sources are labelled error and generation continues', async () => {
    const llm = new MockLLMProvider('openai', { structured: OUTPUT });
    const container = {
      llm: async () => llm,
      github: async () => {
        throw new ConfigError('GITHUB_TOKEN is not configured');
      },
      repoIntel: { getBlastRadius: async () => blastResult },
      db: {},
    } as never;
    const service = new BriefService(container, {
      intentRepo: { getIntent: async () => undefined } as never,
      briefRepo: { upsertBrief: async () => {} },
      changedDiff: async () => loaded(),
      resolveModel: async () => ({ provider: 'openai', model: 'm' }),
    });
    const r = await service.generate({
      workspaceId: 'ws',
      pr: pr({ body: 'Closes #3' }),
      repo,
      log,
    });
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.meta.sources).toContainEqual({ label: 'Linked issue #3', status: 'error' });
  });

  it('diff unavailable: diff missing, review_focus [], refs ground only against blast files (none without a diff)', async () => {
    const s = setup({ diff: { status: 'unavailable', reason: 'no_pr_files' } });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.meta.missing).toEqual(expect.arrayContaining(['blast', 'diff']));
    expect(r.brief.meta.diff_stats).toBeNull();
    expect(r.brief.review_focus).toEqual([]);
    // the diff files are not an allow-list any more and the blast map needs the changed paths
    expect(r.brief.risks.risks).toEqual([]);
    expect(s.getBlastRadius).not.toHaveBeenCalled();
    expect(r.brief.meta.input.blast_degraded_reason).toBe('diff_unavailable');
  });

  it('a blast caller ./src/x.ts is normalized once: a risk citing src/x.ts is kept and stored as src/x.ts', async () => {
    const s = setup({
      structured: {
        summary: 's',
        risks: [
          {
            kind: 'correctness',
            title: 'T',
            explanation: 'x',
            severity: 'low',
            file_refs: ['src/x.ts'],
            anchor_file: null, anchor_start_line: null, anchor_end_line: null,
          },
        ],
        review_focus: [],
      },
      blast: async () => ({
        ...blastResult,
        callers: [{ file: './src/x.ts', symbol: 'run', viaSymbol: 'doThing', line: 4, rank: 1 }],
      }),
    });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.risks.risks).toHaveLength(1);
    expect(r.brief.risks.risks[0]!.file_refs).toEqual(['src/x.ts']);
    expect(r.brief.blast?.downstream.flatMap((d) => d.callers.map((c) => c.file))).toEqual(['src/x.ts']);
    const prompt = JSON.stringify((s.calls()[0]!.req as { messages: unknown }).messages);
    expect(prompt).toContain('src/x.ts:4');
    expect(prompt).not.toContain('./src/x.ts');
  });

  it('blast is queried with normalized, safe-filtered changed paths', async () => {
    const s = setup({ diff: loaded(['./src/a.ts', 'ok/b.ts', '../evil.ts', 'bad\nname.ts']) });
    await s.run();
    expect(s.getBlastRadius).toHaveBeenCalledWith('repo1', ['src/a.ts', 'ok/b.ts']);
  });

  it('diff loaded with 0 files: diff_stats.files 0, diff not missing, review_focus []', async () => {
    const s = setup({ diff: { status: 'loaded', diff: { raw: '', files: [] } as never } });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.meta.input.blast_degraded_reason).toBe('no_changed_files');
    expect(s.getBlastRadius).not.toHaveBeenCalled();
    expect(r.brief.meta.diff_stats?.files).toBe(0);
    expect(r.brief.meta.missing).not.toContain('diff');
    expect(r.brief.review_focus).toEqual([]);
  });

  it('usage 0/0 and costUsd null: tokens and cost are null and the stored shape parses', async () => {
    const llm = new MockLLMProvider('openai', { structured: OUTPUT });
    vi.spyOn(llm, 'completeStructured').mockImplementation((async (req: { schema: { parse: (x: unknown) => unknown } }) => ({
      data: req.schema.parse(OUTPUT),
      model: 'gpt-test',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: null,
      raw: '',
      attempts: 2,
    })) as never);
    const s = setup({ llm });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.meta).toMatchObject({ tokens_in: null, tokens_out: null, cost_usd: null, schema_attempts: 2 });
    expect(PrBriefStored.safeParse(r.brief).success).toBe(true);
    expect(s.upsertBrief).toHaveBeenCalledWith('pr1', expect.objectContaining({ summary: OUTPUT.summary }));
  });

  it('non-zero usage is stored as reported (tokens_in/out and cost_usd)', async () => {
    const llm = new MockLLMProvider('openai', { structured: OUTPUT });
    vi.spyOn(llm, 'completeStructured').mockImplementation((async (req: { schema: { parse: (x: unknown) => unknown } }) => ({
      data: req.schema.parse(OUTPUT),
      model: 'gpt-test',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: '',
      attempts: 1,
    })) as never);
    const s = setup({ llm });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.meta).toMatchObject({ tokens_in: 100, tokens_out: 50, cost_usd: 0.001 });
    expect(PrBriefStored.safeParse(r.brief).success).toBe(true);
    const stored = (s.upsertBrief.mock.calls[0] as unknown as [string, { meta: Record<string, unknown> }])[1];
    expect(stored.meta).toMatchObject({ tokens_in: 100, tokens_out: 50, cost_usd: 0.001 });
  });

  it('generated_at comes from the injected now()', async () => {
    const r = await setup().run();
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.brief.meta.generated_at).toBe('2026-10-09T12:00:00.000Z');
  });

  it('an invalid post-grounding object (risk with no refs) is invalid_output and is not stored', async () => {
    const s = setup({
      opts: {
        ground: () => ({
          risks: [
            { kind: 'other', title: 't', explanation: 'e', severity: 'low' as const, file_refs: [] },
          ],
          review_focus: [],
          counts: { dropped_risks: 0, dropped_refs: 0, dropped_focus: 0, adjusted_lines: 0, dropped_anchors: 0 },
        }),
      },
    });
    const r = await s.run();
    expect(r).toMatchObject({ status: 'failed', outcome: 'invalid_output' });
    expect(s.upsertBrief).not.toHaveBeenCalled();
    expect(r.meta.calls).toBe(1);
  });

  it('prompt over budget: input_over_budget, zero LLM calls, no upsert', async () => {
    const s = setup({ opts: { promptOpts: { budgetTokens: 10 } } });
    const r = await s.run();
    expect(r).toMatchObject({ status: 'failed', outcome: 'input_over_budget' });
    expect(r.meta).toMatchObject({ calls: 0, outcome: 'input_over_budget' });
    expect(s.calls()).toHaveLength(0);
    expect(s.upsertBrief).not.toHaveBeenCalled();
  });

  it('completeStructured rejects: failed, fixed message, nothing stored, provider text not leaked', async () => {
    const llm = new MockLLMProvider('openai', {});
    vi.spyOn(llm, 'completeStructured').mockRejectedValue(
      Object.assign(new Error('upstream down sk-test-123'), { status: 503 }),
    );
    const s = setup({ llm });
    const r = await s.run();
    expect(r).toMatchObject({ status: 'failed', outcome: 'provider_error' });
    if (r.status === 'failed') {
      expect(r.error).not.toContain('sk-test-123');
      expect(JSON.stringify(r.meta)).not.toContain('sk-test-123');
    }
    expect(s.upsertBrief).not.toHaveBeenCalled();
  });

  it('a schema-validation ExternalServiceError is invalid_output with a lower bound of 2 attempts', async () => {
    const llm = new MockLLMProvider('openai', {});
    vi.spyOn(llm, 'completeStructured').mockRejectedValue(
      new ExternalServiceError('OpenAI structured output failed schema validation', {
        raw: 'PROMPT-SENTINEL',
      }),
    );
    const s = setup({ llm });
    const r = await s.run();
    expect(r).toMatchObject({ status: 'failed', outcome: 'invalid_output' });
    expect(r.meta.schemaAttempts).toBe(2);
    expect(JSON.stringify(r)).not.toContain('PROMPT-SENTINEL');
    expect(s.upsertBrief).not.toHaveBeenCalled();
  });

  it('a missing provider key: provider_unavailable naming the Risk Brief setting, zero calls', async () => {
    const llm = new MockLLMProvider('openai', {});
    const upsertBrief = vi.fn();
    const service = new BriefService(
      {
        llm: async () => {
          throw new ConfigError('OPENAI_API_KEY is not configured');
        },
        db: {},
      } as never,
      {
        intentRepo: { getIntent: async () => undefined } as never,
        briefRepo: { upsertBrief },
        resolveModel: async () => ({ provider: 'openai', model: 'm' }),
      },
    );
    const r = await service.generate({ workspaceId: 'ws', pr: pr(), repo, log });
    expect(r).toMatchObject({ status: 'failed', outcome: 'provider_unavailable' });
    if (r.status === 'failed') expect(r.error).toContain('Settings > Models > Risk Brief');
    expect(r.meta.calls).toBe(0);
    expect(llm.calls).toHaveLength(0);
    expect(upsertBrief).not.toHaveBeenCalled();
  });

  it('timeout at 50 s: still pending at 49.9 s, then outcome timeout and no upsert', async () => {
    vi.useFakeTimers();
    const llm = new MockLLMProvider('openai', {});
    vi.spyOn(llm, 'completeStructured').mockImplementation(() => new Promise(() => {}));
    const s = setup({ llm });
    let settled = false;
    const p = s.run().then((x) => {
      settled = true;
      return x;
    });
    await vi.advanceTimersByTimeAsync(49_900);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    const r = await p;
    expect(r).toMatchObject({ status: 'failed', outcome: 'timeout' });
    expect(s.upsertBrief).not.toHaveBeenCalled();
  });

  it('stored JSON has sources with label+status only; spec content never reaches the stored row', async () => {
    const github = new MockGitHubClient();
    vi.spyOn(github, 'readRepoFile').mockResolvedValue(`# Spec\n${SENTINEL}`);
    const s = setup({ github, pr: { body: 'See docs/spec.md' } });
    const r = await s.run();
    if (r.status !== 'ok') throw new Error('expected ok');
    for (const src of r.brief.meta.sources) expect(Object.keys(src).sort()).toEqual(['label', 'status']);
    expect(r.brief.meta.sources).toContainEqual({ label: 'Spec at docs/spec.md', status: 'fetched' });
    const stored = JSON.stringify(s.upsertBrief.mock.calls[0]);
    expect(stored).not.toContain(SENTINEL);
    // ... although the model did see it
    const prompt = JSON.stringify((s.calls()[0]!.req as { messages: unknown }).messages);
    expect(prompt).toContain(SENTINEL);
  });

  it('the blast snapshot is trimmed to the callers the prompt lists', () => {
    const callers = Array.from({ length: 40 }, (_, i) => ({ name: `c${i}`, file: `f${i}.ts`, line: i + 1 }));
    const t = trimBlast({
      changed_symbols: [],
      downstream: [{ symbol: 's', callers, endpoints_affected: [], crons_affected: [] }],
      summary: 'x',
    });
    expect(t.downstream[0]!.callers).toHaveLength(25);
  });
});
