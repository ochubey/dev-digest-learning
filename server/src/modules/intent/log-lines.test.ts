import { describe, it, expect } from 'vitest';
import type { DeriveMeta } from './service.js';
import {
  loadLine,
  resolveRefsLine,
  intentCallsLabel,
  llmCallsLine,
  reviewIntentPolicy,
} from './log-lines.js';

const ASCII = /^[\x00-\x7F]*$/;

const META: DeriveMeta = {
  cache: 'miss',
  refStatuses: {},
  refSources: [{ label: 'Linked issue #12', status: 'fetched' }],
  sources: [],
  warnings: [],
};

describe('loadLine / resolveRefsLine regardless of outcome', () => {
  it('cache hit / miss / bypass', () => {
    expect(loadLine({ ...META, cache: 'hit' })).toBe('intent.load: cache hit');
    expect(loadLine(META)).toBe('intent.load: cache miss');
    expect(loadLine({ ...META, cache: 'bypass' })).toBe('intent.load: cache bypassed (force)');
  });

  it('not reached carries the reason (no meta, or meta.cache=not_reached)', () => {
    expect(loadLine(undefined, 'github boom')).toBe('intent.load: not reached (github boom)');
    expect(loadLine({ ...META, cache: 'not_reached' }, 'x')).toBe('intent.load: not reached (x)');
    expect(resolveRefsLine(undefined, 'github boom')).toBe(
      'intent.resolve_refs: not reached (github boom)',
    );
    expect(resolveRefsLine({ ...META, refsReached: false }, 'x')).toBe(
      'intent.resolve_refs: not reached (x)',
    );
  });

  it('resolved statuses are still shown when derive failed later', () => {
    expect(resolveRefsLine(META, 'llm boom')).toBe('intent.resolve_refs: Linked issue #12: found');
  });

  it('reasons are single-line ASCII', () => {
    const line = loadLine(undefined, 'bad — thing\nnext …');
    expect(line).toMatch(ASCII);
    expect(line).not.toContain('\n');
  });
});

describe('llm.calls intent label: attempt vs success', () => {
  const cases: [Parameters<typeof intentCallsLabel>[0], string][] = [
    [{ status: 'derived', attempts: 1 }, '1 ok'],
    [{ status: 'derived', attempts: 3 }, '3 (retried, 3 attempts) ok'],
    [{ status: 'cached', attempts: 0 }, '0 cached'],
    [{ status: 'failed', attempts: 0 }, '0 skipped'],
    [{ status: 'failed', attempts: 1 }, '1 failed'],
    [{ status: 'failed', attempts: 2 }, '2 (retried, 2 attempts) failed'],
  ];
  for (const [o, want] of cases) {
    it(`${o.status}/${o.attempts} -> ${want}`, () => {
      expect(intentCallsLabel(o)).toBe(want);
      const line = llmCallsLine(o, 2);
      expect(line).toBe(`llm.calls: intent=${want} review=2`);
      expect(line).toMatch(ASCII);
    });
  }
});

describe('reviewIntentPolicy', () => {
  const mk = (confidence: number) => ({
    summary: 's',
    in_scope: ['a'],
    out_of_scope: [],
    confidence,
    sources: [],
    missing_context: [],
  });

  it('no intent: nothing to include, no line', () => {
    expect(reviewIntentPolicy(undefined)).toEqual({ include: false });
  });

  it('confidence 0: omitted from the review prompt with a reason line', () => {
    const p = reviewIntentPolicy(mk(0));
    expect(p.include).toBe(false);
    expect(p.line).toBe(
      'intent.skip: confidence=0 (no description, files or sources); Intent section omitted from review prompt',
    );
    expect(p.line).toMatch(ASCII);
  });

  it('0 < confidence < 0.5: included, flagged low confidence, scope filter inactive', () => {
    const p = reviewIntentPolicy(mk(0.3));
    expect(p.include).toBe(true);
    expect(p.line).toContain('intent.low_confidence: confidence=0.30');
    expect(p.line).toContain('scope filter inactive');
    expect(p.line).toMatch(ASCII);
  });

  it('>= 0.5: included, no line', () => {
    expect(reviewIntentPolicy(mk(0.5))).toEqual({ include: true });
    expect(reviewIntentPolicy(mk(0.9))).toEqual({ include: true });
  });
});
