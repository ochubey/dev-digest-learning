import { describe, it, expect } from 'vitest';
import { groundOutOfScope } from './scope-grounding.js';

const EVIDENCE = [
  'feat: L01 - CLAUDE.md, engineering-insights skill, severity and cost badges',
  'closes every gap from the grading rubric; changes unrelated to L01 are left alone',
  'client/src/components/Popover.tsx',
].join('\n');

describe('groundOutOfScope', () => {
  it('drops items with no support in the evidence (values echoed from the old prompt example)', () => {
    const r = groundOutOfScope(['admin dashboard', 'email verification'], EVIDENCE);
    expect(r.kept).toEqual([]);
    expect(r.dropped).toEqual(['admin dashboard', 'email verification']);
  });

  it('keeps items grounded in the text, even when paraphrased', () => {
    const r = groundOutOfScope(['changes to existing grading rubric gaps not related to L01'], EVIDENCE);
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toEqual([]);
  });

  it('matches case-insensitively and against file paths', () => {
    expect(groundOutOfScope(['POPOVER redesign'], EVIDENCE).kept).toEqual(['POPOVER redesign']);
  });

  it('keeps items it cannot judge (no word of 4+ characters)', () => {
    expect(groundOutOfScope(['UI', 'CI'], EVIDENCE).kept).toEqual(['UI', 'CI']);
  });

  it('handles an empty list and empty evidence', () => {
    expect(groundOutOfScope([], EVIDENCE)).toEqual({ kept: [], dropped: [] });
    expect(groundOutOfScope(['payments refactor'], '').dropped).toEqual(['payments refactor']);
  });

  it('supports non-latin text', () => {
    expect(groundOutOfScope(['панель адміністратора'], 'не чіпаємо панель адміністратора').kept).toHaveLength(1);
    expect(groundOutOfScope(['панель адміністратора'], 'нічого схожого').dropped).toHaveLength(1);
  });
});
