import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { changedLines } from '../src/index.js';

const hunk = (file: string, newStart: number, newLines: number, nums?: number[]) => ({
  file,
  oldStart: 1,
  oldLines: 1,
  newStart,
  newLines,
  newLineNumbers: nums ?? [],
});
const file = (path: string, hunks: ReturnType<typeof hunk>[]) => ({
  path,
  additions: 0,
  deletions: 0,
  hunks,
});

describe('changedLines', () => {
  it('collects lines across multiple hunks', () => {
    const diff: UnifiedDiff = {
      raw: '',
      files: [file('a.ts', [hunk('a.ts', 1, 2, [1, 2]), hunk('a.ts', 10, 3)])],
    };
    expect([...changedLines(diff).get('a.ts')!].sort((x, y) => x - y)).toEqual([1, 2, 10, 11, 12]);
  });

  it('keys per file', () => {
    const diff: UnifiedDiff = {
      raw: '',
      files: [file('a.ts', [hunk('a.ts', 1, 1, [1])]), file('b.ts', [hunk('b.ts', 5, 1, [5])])],
    };
    const m = changedLines(diff);
    expect([...m.keys()]).toEqual(['a.ts', 'b.ts']);
    expect(m.get('b.ts')!.has(5)).toBe(true);
    expect(m.get('b.ts')!.has(1)).toBe(false);
  });

  it('deletion-only hunk counts its newStart line', () => {
    const diff: UnifiedDiff = { raw: '', files: [file('a.ts', [hunk('a.ts', 7, 0)])] };
    expect([...changedLines(diff).get('a.ts')!]).toEqual([7]);
  });

  it('empty diff yields empty map', () => {
    expect(changedLines({ raw: '', files: [] }).size).toBe(0);
  });
});
