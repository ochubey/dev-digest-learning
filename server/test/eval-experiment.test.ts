import { describe, it, expect } from 'vitest';
import type { EvalCaseResult, EvalRunManifest } from '@devdigest/shared';
import { runEvalCases, type RunnableCase } from '../src/modules/evals/runner.js';
import { scoreRun } from '../src/modules/evals/scoring.js';
import { SEED_EVAL_CASES } from '../src/db/fixtures/eval-cases.js';
import { SECURITY_REVIEWER_PROMPT } from '../src/db/seed-prompts.js';
import { BROKEN_MARKER, SILENT_MARKER, promptAwareLLM } from './helpers/prompt-aware-llm.js';

const cases: RunnableCase[] = SEED_EVAL_CASES.map((c, i) => ({
  id: `res-${i}`,
  case_id: `case-${i}`,
  name: c.name,
  expectation: c.expectation,
  origin: c.origin,
  input_diff: c.input_diff,
}));

const manifestWith = (system_prompt: string): EvalRunManifest => ({
  provider: 'openrouter',
  model: 'fake/model',
  system_prompt,
  output_schema: null,
  strategy: 'single-pass',
  ci_fail_on: 'critical',
  repo_intel: true,
  skills: [],
  skill_versions: [],
});

async function experiment(system_prompt: string) {
  const llm = promptAwareLLM(SEED_EVAL_CASES.map((c) => c.expectation));
  const results: EvalCaseResult[] = await runEvalCases({
    cases,
    manifest: manifestWith(system_prompt),
    skillBodies: [],
    llm,
    concurrency: 3,
    timeoutMs: 10_000,
  });
  return { llm, results, ...scoreRun(results) };
}

describe('eval experiment: the same seeded cases under three prompts (fake provider, no DB, no network)', () => {
  it('a broken prompt scores lower precision than a good one; a silent prompt changes recall', async () => {
    const good = await experiment(SECURITY_REVIEWER_PROMPT);
    const broken = await experiment(`${SECURITY_REVIEWER_PROMPT}\n${BROKEN_MARKER}`);
    const silent = await experiment(`${SECURITY_REVIEWER_PROMPT}\n${SILENT_MARKER}`);

    expect(good.metrics.recall).toBe(1);
    expect(good.metrics.precision).toBe(1);
    expect(good.counts.must_not_flag_violated).toBe(0);

    expect(broken.metrics.precision!).toBeLessThan(good.metrics.precision!);
    expect(broken.counts.must_not_flag_violated).toBeGreaterThan(0);
    expect(broken.counts.fp_zone).toBeGreaterThan(0);

    expect(silent.metrics.recall).toBe(0);
    expect(silent.metrics.recall).not.toBe(good.metrics.recall);
    expect(silent.metrics.precision).toBeNull();
    expect(silent.counts.cases_passed).toBe(silent.counts.must_not_flag_total);
  });

  it('is deterministic and makes only structured calls, one per case', async () => {
    const a = await experiment(SECURITY_REVIEWER_PROMPT);
    const b = await experiment(SECURITY_REVIEWER_PROMPT);
    expect(b.counts).toEqual(a.counts);
    expect(a.llm.calls).toHaveLength(SEED_EVAL_CASES.length);
    expect(a.llm.otherCalls).toEqual([]);
    expect(a.results.every((r) => r.status === 'ok')).toBe(true);
  });
});
