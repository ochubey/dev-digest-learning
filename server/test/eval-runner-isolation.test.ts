import { describe, it, expect } from 'vitest';
import type { EvalRunManifest } from '@devdigest/shared';
import { runEvalCases, type RunnableCase } from '../src/modules/evals/runner.js';
import { RecordingLLM } from './helpers/recording-llm.js';
import { fragmentWith } from './helpers/fake-eval-store.js';

/**
 * AC-88: every case is its own stateless model call: no tools, a fresh message list, and
 * no access to other cases, earlier or concurrent runs, stored results or expectations.
 * Sentinels placed in everything the runner must not forward are searched for in every call.
 */
const manifest: EvalRunManifest = {
  provider: 'openrouter',
  model: 'test/model-a',
  system_prompt: 'You are the original reviewer.',
  output_schema: null,
  strategy: 'auto',
  ci_fail_on: 'critical',
  repo_intel: true,
  skills: [],
  skill_versions: [],
};

const SENTINELS = {
  caseNameA: 'SENTINEL_CASE_NAME_A_0c19',
  caseNameB: 'SENTINEL_CASE_NAME_B_93d2',
  expectedFile: 'SENTINEL/expected-file.ts',
};

const mkCase = (n: 1 | 2, name: string): RunnableCase => ({
  id: `res-${n}`,
  case_id: `case-${n}`,
  name,
  expectation: { kind: n === 1 ? 'must_find' : 'must_not_flag', file: SENTINELS.expectedFile, start_line: 11, end_line: 11 },
  origin: 'dismissed_finding',
  input_diff: fragmentWith(`MARKER_FRAGMENT_${n}`),
});

describe('eval runner isolation (AC-88)', () => {
  it('each call is one fresh system+user list with no tools and no other case, run or result data', async () => {
    const llm = new RecordingLLM({
      delayMs: 5,
      // The model answers with a finding whose title could leak into a later call if state was shared.
      findings: () => [{ file: 'src/config.ts', start_line: 11, end_line: 11, title: 'ANSWER_TITLE_SENTINEL_5a6c' }],
    });
    const cases = [mkCase(1, SENTINELS.caseNameA), mkCase(2, SENTINELS.caseNameB)];
    await runEvalCases({ cases, manifest, skillBodies: [], llm, concurrency: 3, timeoutMs: 120_000 });

    expect(llm.calls).toHaveLength(2);
    expect(llm.otherCalls).toEqual([]);

    for (const call of llm.calls) {
      // Fresh two-message list: no assistant turns, no history.
      expect(call.messages.map((m) => m.role)).toEqual(['system', 'user']);
      // No tool, session or extra request keys.
      expect(call.requestKeys).toEqual(['maxRetries', 'messages', 'model', 'schema', 'schemaName']);
      expect(call.model).toBe(manifest.model);
    }

    const everything = JSON.stringify(llm.calls.map((c) => c.messages));
    for (const s of Object.values(SENTINELS)) expect(everything).not.toContain(s);
    // Model output of one case never reaches another call.
    expect(everything).not.toContain('ANSWER_TITLE_SENTINEL_5a6c');
    // Case 1's call has only case 1's fragment, and vice versa.
    const [one, two] = [
      llm.calls.find((c) => c.messages[1]!.content.includes('MARKER_FRAGMENT_1'))!,
      llm.calls.find((c) => c.messages[1]!.content.includes('MARKER_FRAGMENT_2'))!,
    ];
    expect(one.messages[1]!.content).not.toContain('MARKER_FRAGMENT_2');
    expect(two.messages[1]!.content).not.toContain('MARKER_FRAGMENT_1');
    expect(one.messages).not.toBe(two.messages);
  });

  it('a second run of the same cases sends the same content and nothing from the first run', async () => {
    const first = new RecordingLLM({ findings: () => [{ file: 'src/config.ts', start_line: 11, end_line: 11, title: 'FIRST_RUN_ANSWER_c07e' }] });
    const second = new RecordingLLM();
    const cases = [mkCase(1, SENTINELS.caseNameA)];
    await runEvalCases({ cases, manifest, skillBodies: [], llm: first, concurrency: 3, timeoutMs: 120_000 });
    await runEvalCases({ cases, manifest: { ...manifest, model: 'test/model-b' }, skillBodies: [], llm: second, concurrency: 3, timeoutMs: 120_000 });
    expect(JSON.stringify(second.calls)).not.toContain('FIRST_RUN_ANSWER_c07e');
    expect(second.calls[0]!.model).toBe('test/model-b');
    expect(second.userMessages()).toEqual(first.userMessages());
  });
});
