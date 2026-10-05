import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { isVisibleScope, isInScope, inScopeCondition } from '../src/modules/reviews/scope-visibility.js';

describe('scope-visibility', () => {
  it.each([
    ['in', true, true],
    ['out', false, false],
    ['signal', true, false],
    [null, true, true],
    [undefined, true, true],
  ] as const)('scope=%s -> visible=%s inScope=%s', (scope, visible, inScope) => {
    expect(isVisibleScope(scope)).toBe(visible);
    expect(isInScope(scope)).toBe(inScope);
  });

  it('inScopeCondition renders NULL-or-in SQL', () => {
    const { sql, params } = new PgDialect().sqlToQuery(inScopeCondition());
    expect(sql).toContain('is null');
    expect(sql).toContain('"scope"');
    expect(params).toEqual(['in']);
  });
});
