import { describe, it, expect } from 'vitest';
import { runStartLine, runEndLine, caseErrorLine } from '../src/modules/evals/log-lines.js';

describe('eval log lines', () => {
  it('start/end/error formats; no fragment parameter exists', () => {
    expect(runStartLine({ agent: 'Security Reviewer', version: 3, cases: 9, model: 'gpt-x' })).toBe(
      'eval.run start: agent="Security Reviewer" version=3 cases=9 model=gpt-x',
    );
    expect(
      runEndLine({
        status: 'completed',
        metrics: { recall: 0.75, precision: null, citation_accuracy: 1 },
        durationMs: 1234,
        cost: 0.0123,
      }),
    ).toBe('eval.run end: status=completed recall=0.75 precision=null citation_accuracy=1 duration_ms=1234 cost_usd=0.0123');
    expect(
      runEndLine({
        status: 'failed',
        metrics: { recall: null, precision: null, citation_accuracy: null },
        durationMs: 5,
        cost: null,
      }),
    ).toContain('cost_usd=null');
    expect(caseErrorLine('case-1', 'timeout')).toBe('eval.case error: case=case-1 reason=timeout');
    expect(caseErrorLine('case-1', 'line one\nsecret line two')).toBe('eval.case error: case=case-1 reason=line one');
    // no fragment/diff parameter: arities are fixed
    expect(runStartLine.length).toBe(1);
    expect(caseErrorLine.length).toBe(2);
  });
});
