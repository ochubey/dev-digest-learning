import { describe, it, expect } from 'vitest';
import { taskLine, findingRowToDto } from '../src/modules/reviews/helpers.js';

/**
 * Unit coverage for the review task-line. The key invariant: our trusted
 * instruction always tells the model to review the whole diff and never
 * withhold a security/correctness finding — no matter what the PR text claims.
 */

describe('taskLine', () => {
  const pull = { number: 3, title: 'test: vulnerable fixture', author: 'burnjohn' } as never;

  it('names the PR being reviewed', () => {
    const line = taskLine(pull);
    expect(line).toContain('#3');
    expect(line).toContain('test: vulnerable fixture');
  });

  it('keeps the non-negotiable "never withhold security" rule', () => {
    const line = taskLine(pull);
    expect(line).toMatch(/never .*withhold .*(or downgrade )?.*security/i);
    expect(line).toMatch(/review the entire diff/i);
  });
});

describe('findingRowToDto scope mapping', () => {
  const base = {
    id: 'f1',
    reviewId: 'r1',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'a.ts',
    startLine: 1,
    endLine: 1,
    rationale: 'r',
    suggestion: null,
    confidence: 0.5,
    kind: 'finding',
    trifectaComponents: null,
    acceptedAt: null,
    dismissedAt: null,
  };

  it('maps scope + scope_reason from the row', () => {
    const dto = findingRowToDto({ ...base, scope: 'out', scopeReason: 'unrelated' } as never);
    expect(dto.scope).toBe('out');
    expect(dto.scope_reason).toBe('unrelated');
  });

  it('legacy rows (null columns) map to null', () => {
    const dto = findingRowToDto({ ...base, scope: null, scopeReason: null } as never);
    expect(dto.scope).toBeNull();
    expect(dto.scope_reason).toBeNull();
  });
});
