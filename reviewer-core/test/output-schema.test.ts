import { describe, it, expect } from 'vitest';
import { Finding } from '@devdigest/shared';
import { ModelFinding, ModelReview, toJsonSchema } from '../src/index.js';

const base = {
  id: 'f1',
  severity: 'CRITICAL',
  category: 'security',
  title: 't',
  file: 'a.ts',
  start_line: 1,
  end_line: 1,
  rationale: 'r',
  confidence: 0.9,
  kind: 'finding',
};

describe('ModelFinding scope fields', () => {
  it.each(['in', 'out', 'signal'])('accepts scope=%s', (scope) => {
    const r = ModelFinding.safeParse({ ...base, scope, scope_reason: 'why' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.scope).toBe(scope);
      expect(r.data.scope_reason).toBe('why');
    }
  });

  it("parses an invalid scope ('banana') to null without throwing", () => {
    const r = ModelFinding.safeParse({ ...base, scope: 'banana' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.scope).toBeNull();
  });

  it('treats a missing scope as nullish', () => {
    const r = ModelFinding.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.scope ?? null).toBeNull();
      expect(r.data.scope_reason ?? null).toBeNull();
    }
  });

  it('does not limit scope_reason length', () => {
    const long = 'x'.repeat(5000);
    const r = ModelFinding.safeParse({ ...base, scope: 'out', scope_reason: long });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.scope_reason).toBe(long);
  });

  it('ModelReview parses findings with scope', () => {
    const r = ModelReview.safeParse({
      verdict: 'comment',
      summary: 's',
      score: 80,
      findings: [{ ...base, scope: 'banana' }, { ...base, id: 'f2', scope: 'in' }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.findings.map((f) => f.scope)).toEqual([null, 'in']);
  });

  it('JSON schema exposes the scope enum', () => {
    const { schema } = toJsonSchema(ModelReview, 'Review');
    const s = JSON.stringify(schema);
    expect(s).toContain('"enum":["in","out","signal"]');
    expect(s).toContain('"scope"');
    expect(s).toContain('"in"');
    expect(s).toContain('"out"');
    expect(s).toContain('"signal"');
    expect(s).toContain('"scope_reason"');
  });

  it('scope enum values equal the shared Finding scope enum (fails if shared gains a value)', () => {
    const shared = Finding.shape.scope.unwrap().unwrap().options;
    const model = ModelFinding.shape.scope.removeCatch().unwrap().unwrap().options;
    expect([...model]).toEqual([...shared]);
  });
});
