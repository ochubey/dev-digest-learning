import { describe, it, expect } from 'vitest';
import { PrHistory, type MergedPrWithFiles } from '@devdigest/shared';
import { buildPrHistory } from '../src/modules/blast/history.js';
import { HISTORY_LIMIT } from '../src/modules/blast/constants.js';

const pr = (n: number, files: string[], merged_at = `2026-01-${String(n).padStart(2, '0')}T00:00:00Z`): MergedPrWithFiles => ({
  number: n,
  title: `PR ${n}`,
  author: 'a',
  merged_at,
  files,
});

describe('buildPrHistory', () => {
  it('keeps only PRs that touched a changed file and reports the overlap', () => {
    const out = buildPrHistory(
      [pr(1, ['a.ts', 'b.ts']), pr(2, ['c.ts']), pr(3, ['b.ts', 'd.ts'])],
      ['b.ts', 'a.ts'],
    );
    expect(out.history.map((h) => h.pr_number)).toEqual([3, 1]);
    expect(out.history.find((h) => h.pr_number === 1)!.files_overlap).toEqual(['a.ts', 'b.ts']);
    expect(out.history.find((h) => h.pr_number === 3)!.files_overlap).toEqual(['b.ts']);
  });

  it('orders newest merge first and caps the list', () => {
    const many = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => pr(i + 1, ['a.ts']));
    const out = buildPrHistory(many, ['a.ts']);
    expect(out.history).toHaveLength(HISTORY_LIMIT);
    expect(out.history[0]!.pr_number).toBe(HISTORY_LIMIT + 5);
  });

  it('returns an empty history when nothing overlaps or nothing changed', () => {
    expect(buildPrHistory([pr(1, ['x.ts'])], ['a.ts']).history).toEqual([]);
    expect(buildPrHistory([pr(1, ['a.ts'])], []).history).toEqual([]);
  });

  it('produces output that passes the PrHistory contract', () => {
    expect(() => PrHistory.parse(buildPrHistory([pr(1, ['a.ts'])], ['a.ts']))).not.toThrow();
  });
});
