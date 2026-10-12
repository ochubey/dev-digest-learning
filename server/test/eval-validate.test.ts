import { describe, it, expect } from 'vitest';
import { validateCaseInput } from '../src/modules/evals/validate.js';

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' one',
  '+two',
  ' three',
  '',
].join('\n');

const valid = () => ({
  name: 'case',
  expectation: { kind: 'must_find', file: 'src/a.ts', start_line: 2, end_line: 3 },
  input_diff: DIFF,
});

describe('validateCaseInput', () => {
  it('empty name / bad kind / start<1 / end<start / empty fragment / unparsable / file absent / range outside hunks -> one reason each', () => {
    expect(validateCaseInput(valid())).toEqual([]);
    const withExp = (e: Record<string, unknown>) => ({ ...valid(), expectation: { ...valid().expectation, ...e } });
    const cases = [
      { ...valid(), name: '   ' },
      withExp({ kind: 'maybe' }),
      withExp({ start_line: 0 }),
      withExp({ start_line: 5, end_line: 3 }),
      { ...valid(), input_diff: '' },
      { ...valid(), input_diff: 'not a diff at all' },
      withExp({ file: 'src/zzz.ts' }),
      withExp({ start_line: 50, end_line: 60 }),
    ];
    for (const c of cases) expect(validateCaseInput(c)).toHaveLength(1);
    const reasons = cases.map((c) => validateCaseInput(c)[0]);
    expect(new Set(reasons).size).toBe(cases.length);
  });
});
