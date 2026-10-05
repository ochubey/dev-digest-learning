import { describe, it, expect } from 'vitest';
import {
  applyConfidenceCaps,
  CAP_EMPTY_BODY,
  CAP_EMPTY_BODY_FILES_ONLY,
  CAP_UNAVAILABLE_EXPLICIT_SOURCE,
  CAP_UNAVAILABLE_OTHER_REF,
} from './confidence.js';

const base = { modelConfidence: 0.9, bodyEmpty: false, statuses: {}, anyFetched: true, hasFiles: true };

describe('applyConfidenceCaps (ceiling computed in code, min(model, cap))', () => {
  it('exposes the documented ceilings', () => {
    expect(CAP_EMPTY_BODY).toBe(0.4);
    expect(CAP_EMPTY_BODY_FILES_ONLY).toBe(0.3);
    expect(CAP_UNAVAILABLE_EXPLICIT_SOURCE).toBe(0.5);
    expect(CAP_UNAVAILABLE_OTHER_REF).toBe(0.7);
  });

  it('leaves the model value untouched when nothing limits it', () => {
    const r = applyConfidenceCaps(base);
    expect(r.confidence).toBe(0.9);
    expect(r.reasons).toEqual([]);
  });

  it('empty description: capped at 0.4 when an external source was fetched', () => {
    const r = applyConfidenceCaps({ ...base, bodyEmpty: true, statuses: { linked_issue: 'fetched' } });
    expect(r.confidence).toBe(0.4);
    expect(r.reasons.join(' ')).toMatch(/empty description/);
  });

  it('empty description, no external source but changed files: low confidence (0.3), not 0', () => {
    const r = applyConfidenceCaps({ ...base, bodyEmpty: true, anyFetched: false, hasFiles: true });
    expect(r.confidence).toBe(0.3);
    expect(r.reasons.join(' ')).toMatch(/only the title and changed files/);
  });

  it('a model value below the cap is kept (empty description, files only)', () => {
    expect(
      applyConfidenceCaps({ ...base, modelConfidence: 0.15, bodyEmpty: true, anyFetched: false }).confidence,
    ).toBe(0.15);
  });

  it('empty description, no changed files and no fetched source: 0 (nothing to go on)', () => {
    const r = applyConfidenceCaps({ ...base, bodyEmpty: true, anyFetched: false, hasFiles: false });
    expect(r.confidence).toBe(0);
    expect(r.reasons.join(' ')).toMatch(/no changed files/);
  });

  it.each([
    ['linked ticket', { linked_issue: 'unavailable' }],
    ['plan', { 'plan_at_docs/p.md': 'unavailable' }],
    ['spec', { 'spec_at_docs/s.md': 'unavailable' }],
  ] as const)('an explicitly referenced %s that is unavailable caps at 0.5', (_n, statuses) => {
    const r = applyConfidenceCaps({ ...base, statuses: { ...statuses } });
    expect(r.confidence).toBe(0.5);
    expect(r.reasons.join(' ')).toMatch(/0\.5/);
  });

  it('a fetch error on a plan/spec/ticket counts as unavailable (0.5)', () => {
    expect(applyConfidenceCaps({ ...base, statuses: { linked_issue: 'error' } }).confidence).toBe(0.5);
  });

  it('other unavailable explicit references (another repository) cap at 0.7', () => {
    const r = applyConfidenceCaps({ ...base, statuses: { 'issue_a/b#9': 'unavailable' } });
    expect(r.confidence).toBe(0.7);
    expect(r.reasons.join(' ')).toMatch(/0\.7/);
  });

  it('the stricter cap wins when both kinds are unavailable', () => {
    const r = applyConfidenceCaps({
      ...base,
      statuses: { 'issue_a/b#9': 'unavailable', 'plan_at_docs/p.md': 'unavailable' },
    });
    expect(r.confidence).toBe(0.5);
  });

  it('never raises the model value: min(model, cap)', () => {
    expect(applyConfidenceCaps({ ...base, modelConfidence: 0.3, statuses: { linked_issue: 'unavailable' } }).confidence).toBe(0.3);
    expect(applyConfidenceCaps({ ...base, modelConfidence: 0.6, statuses: { 'issue_a/b#9': 'unavailable' } }).confidence).toBe(0.6);
  });

  it('fetched sources do not limit confidence', () => {
    const r = applyConfidenceCaps({
      ...base,
      statuses: { linked_issue: 'fetched', 'plan_at_docs/p.md': 'fetched' },
    });
    expect(r.confidence).toBe(0.9);
  });

  it('reasons are ASCII only (they go to the run log)', () => {
    const r = applyConfidenceCaps({
      ...base,
      bodyEmpty: true,
      statuses: { linked_issue: 'unavailable', 'issue_a/b#9': 'unavailable' },
    });
    for (const line of r.reasons) expect(line).toMatch(/^[\x00-\x7F]*$/);
  });
});
