import { describe, it, expect, afterEach, vi } from 'vitest';
import type { EvalCaseResult, EvalRunManifest } from '@devdigest/shared';
import { runEvalCases, sanitizeError, type RunnableCase } from '../src/modules/evals/runner.js';
import { buildManifest } from '../src/modules/evals/manifest.js';
import { EVAL_TASK_LINE } from '../src/modules/evals/constants.js';
import { RecordingLLM } from './helpers/recording-llm.js';
import { agentRow, fragmentWith } from './helpers/fake-eval-store.js';

const manifest: EvalRunManifest = {
  provider: 'openrouter',
  model: 'test/model-a',
  system_prompt: 'You are the original reviewer.',
  output_schema: null,
  strategy: 'single-pass',
  ci_fail_on: 'critical',
  repo_intel: true,
  skills: [],
  skill_versions: [],
};

const mkCase = (n: number, over: Partial<RunnableCase> = {}): RunnableCase => ({
  id: `res-${n}`,
  case_id: `case-${n}`,
  name: `case-name-${n}`,
  expectation: { kind: 'must_find', file: 'src/config.ts', start_line: 11, end_line: 11 },
  origin: 'seeded',
  input_diff: fragmentWith(`marker_${n}`),
  ...over,
});

const run = (cases: RunnableCase[], llm: RecordingLLM, over: Partial<Parameters<typeof runEvalCases>[0]> = {}) =>
  runEvalCases({ cases, manifest, skillBodies: [], llm, concurrency: 3, timeoutMs: 120_000, ...over });

afterEach(() => {
  vi.useRealTimers();
});

describe('runEvalCases', () => {
  it('sends only the system prompt, the fixed task line and the fragment; no PR/intent/repo/context/memory sections', async () => {
    const llm = new RecordingLLM();
    const c = mkCase(1);
    await run([c], llm, { skillBodies: ['SKILL BODY ONE'] });
    expect(llm.calls).toHaveLength(1);
    const [msgs] = [llm.calls[0]!.messages];
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user']);
    expect(msgs[0]!.content.startsWith(manifest.system_prompt)).toBe(true);
    // Exact user message: task line, skills, diff. Nothing else.
    expect(msgs[1]!.content).toBe(
      [
        EVAL_TASK_LINE,
        '## Skills / rules\nSKILL BODY ONE',
        `## Diff to review\n<untrusted source="diff">\n${c.input_diff}\n</untrusted>`,
      ].join('\n\n'),
    );
    for (const heading of [
      '## PR description',
      '## Intent',
      '## Relevant memory',
      '## Repo skeleton',
      '## Project context',
      '## Callers of changed symbols',
    ]) {
      expect(msgs[1]!.content).not.toContain(heading);
    }
    expect(msgs[0]!.content).not.toContain('SCOPE LABELS');
  });

  it('never puts the case name, notes or expectation in any message', async () => {
    const llm = new RecordingLLM();
    const c = mkCase(1, {
      name: 'SENTINEL_NAME_91c3',
      origin: 'accepted_finding',
      expectation: { kind: 'must_not_flag', file: 'src/config.ts', start_line: 11, end_line: 11 },
    });
    await run([c], llm);
    const all = JSON.stringify(llm.calls.map((x) => x.messages));
    expect(all).not.toContain('SENTINEL_NAME_91c3');
    expect(all).not.toContain('must_not_flag');
    expect(all).not.toContain('accepted_finding');
    expect(all).not.toContain('case-1');
  });

  it('two manifests over the same cases send byte-identical user content', async () => {
    const a = new RecordingLLM();
    const b = new RecordingLLM();
    const cases = [mkCase(1), mkCase(2)];
    await run(cases, a);
    await run(cases, b, {
      manifest: { ...manifest, model: 'test/model-b', system_prompt: 'A completely different prompt.' },
    });
    expect(b.userMessages()).toEqual(a.userMessages());
    expect(b.systemMessages()).not.toEqual(a.systemMessages());
    expect(b.calls[0]!.model).toBe('test/model-b');
  });

  it('maps grounded findings, dropped findings with a reason, pass, duration, tokens and cost', async () => {
    const llm = new RecordingLLM({
      tokensIn: 120,
      tokensOut: 30,
      costUsd: 0.002,
      findings: () => [
        { file: 'src/config.ts', start_line: 11, end_line: 11, title: 'Hardcoded key', severity: 'CRITICAL', category: 'security' },
        { file: 'src/config.ts', start_line: 12, end_line: 12, title: 'Other', severity: 'WARNING', category: 'bug' },
        { file: 'src/elsewhere.ts', start_line: 5, end_line: 5, title: 'Not in diff' },
      ],
    });
    const seen: EvalCaseResult[] = [];
    const [r] = await run([mkCase(1)], llm, { onResult: (x) => void seen.push(x) });
    expect(seen).toEqual([r]);
    expect(r).toMatchObject({
      id: 'res-1',
      case_id: 'case-1',
      status: 'ok',
      pass: true,
      tokens_in: 120,
      tokens_out: 30,
      cost_usd: 0.002,
      error: null,
    });
    expect(r!.duration_ms).toBeGreaterThanOrEqual(0);
    expect(r!.grounded).toEqual([
      { file: 'src/config.ts', start_line: 11, end_line: 11, severity: 'CRITICAL', category: 'security', title: 'Hardcoded key', match: 'tp' },
      { file: 'src/config.ts', start_line: 12, end_line: 12, severity: 'WARNING', category: 'bug', title: 'Other', match: 'unlabeled' },
    ]);
    expect(r!.dropped).toHaveLength(1);
    expect(r!.dropped[0]).toMatchObject({ file: 'src/elsewhere.ts', title: 'Not in diff' });
    expect(r!.dropped[0]!.reason).toBeTruthy();
  });

  it('a provider failure on 1 of 3 cases becomes a sanitized error; the others continue', async () => {
    const llm = new RecordingLLM({
      throwFor: (c) =>
        c.messages[1]!.content.includes('marker_2')
          ? new Error('401 invalid key sk-or-v1-abcdef123456 for OPENROUTER_API_KEY=sk-secret99999\nstack line two')
          : undefined,
    });
    const logs: string[] = [];
    const out = await run([mkCase(1), mkCase(2), mkCase(3)], llm, { log: (l) => void logs.push(l) });
    expect(out.map((r) => r.status)).toEqual(['ok', 'error', 'ok']);
    const err = out[1]!;
    expect(err.pass).toBeNull();
    expect(err.error).not.toContain('sk-or-v1-abcdef123456');
    expect(err.error).not.toContain('sk-secret99999');
    expect(err.error).not.toContain('stack line two');
    expect(err.error!.length).toBeLessThanOrEqual(300);
    expect(logs).toEqual([`eval.case error: case=case-2 reason=${err.error}`]);
  });

  it('runs at most 3 cases at a time', async () => {
    const llm = new RecordingLLM({ delayMs: 15 });
    const cases = Array.from({ length: 8 }, (_, i) => mkCase(i + 1));
    const out = await run(cases, llm);
    expect(out).toHaveLength(8);
    expect(llm.maxInFlight).toBe(3);
  });

  it('marks a case that exceeds the timeout as "timeout" (fake timers, 120 s)', async () => {
    vi.useFakeTimers();
    const llm = new RecordingLLM({ hang: (c) => c.messages[1]!.content.includes('marker_1') });
    const p = run([mkCase(1), mkCase(2)], llm);
    await vi.advanceTimersByTimeAsync(119_000);
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    const out = await p;
    expect(out[0]).toMatchObject({ status: 'error', error: 'timeout', pass: null });
    expect(out[1]!.status).toBe('ok');
  });

  it('log lines contain no fragment text', async () => {
    const llm = new RecordingLLM({ throwFor: () => new Error('provider exploded') });
    const logs: string[] = [];
    await run([mkCase(1, { input_diff: fragmentWith('FRAGMENT_SENTINEL_7d2') })], llm, {
      log: (l) => void logs.push(l),
    });
    expect(logs).toHaveLength(1);
    expect(logs.join('\n')).not.toContain('FRAGMENT_SENTINEL_7d2');
  });

  it('stops calling the model after a result sink failure and rethrows it', async () => {
    const llm = new RecordingLLM();
    const cases = Array.from({ length: 6 }, (_, i) => mkCase(i + 1));
    await expect(
      run(cases, llm, {
        concurrency: 1,
        onResult: () => {
          throw new Error('db down');
        },
      }),
    ).rejects.toThrow('db down');
    expect(llm.calls).toHaveLength(1);
  });
});

describe('sanitizeError', () => {
  it('keeps the first line, redacts keys and caps at 300 characters', () => {
    expect(sanitizeError(new Error('x'.repeat(500)))).toHaveLength(300);
    expect(sanitizeError(new Error('Bearer abcdefghijklmnop failed'))).toBe('[redacted] failed');
    expect(sanitizeError('plain string')).toBe('plain string');
    expect(sanitizeError(new Error(''))).toBe('review failed');
  });
});

describe('buildManifest', () => {
  it('equals the version snapshot plus the enabled skills used', () => {
    const m = buildManifest(agentRow({ id: 'a1' }), ['s1', 's2'], [{ id: 's1', name: 'Rubric', version: 4 }]);
    expect(m).toMatchObject({
      provider: 'openrouter',
      model: 'test/model-a',
      system_prompt: 'You are the original reviewer.',
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: ['s1', 's2'],
      skill_versions: [{ id: 's1', name: 'Rubric', version: 4 }],
    });
  });
});
