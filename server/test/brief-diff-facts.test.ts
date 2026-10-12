import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { diffFacts, diffStats } from '../src/modules/brief/diff-facts.js';

type F = UnifiedDiff['files'][number];
const hunk = (file: string, newStart: number, newLines: number, oldLines = 1) => ({
  file,
  oldStart: newStart,
  oldLines,
  newStart,
  newLines,
  newLineNumbers: [],
});
const file = (path: string, hunks: ReturnType<typeof hunk>[], additions = 1, deletions = 0): F => ({
  path,
  additions,
  deletions,
  hunks,
});

describe('diffFacts', () => {
  it('builds ranges from newStart/newLines and has no status key', () => {
    const facts = diffFacts([file('src/a.ts', [hunk('src/a.ts', 10, 5), hunk('src/a.ts', 50, 1)])]);
    expect(facts).toHaveLength(1);
    expect(facts[0]!.ranges).toEqual([
      [10, 14],
      [50, 50],
    ]);
    expect(Object.keys(facts[0]!).sort()).toEqual(
      ['additions', 'deletions', 'path', 'ranges', 'role'].sort(),
    );
    expect(JSON.stringify(facts)).not.toContain('status');
  });
  it('skips newLines=0 hunks in ranges and drops files with none (deleted)', () => {
    const facts = diffFacts([
      file('gone.ts', [hunk('gone.ts', 0, 0, 5)], 0, 5),
      file('mixed.ts', [hunk('mixed.ts', 3, 0), hunk('mixed.ts', 9, 2)]),
    ]);
    expect(facts.map((f) => f.path)).toEqual(['mixed.ts']);
    expect(facts[0]!.ranges).toEqual([[9, 10]]);
  });
  it('drops binary/pure-rename entries with no hunks', () => {
    expect(diffFacts([file('img.png', [], 0, 0)])).toEqual([]);
  });
  it('keys a rename with hunks by its new path only', () => {
    const facts = diffFacts([file('new/b.ts', [hunk('new/b.ts', 1, 2)])]);
    expect(facts.map((f) => f.path)).toEqual(['new/b.ts']);
  });
  it('excludes unsafe paths', () => {
    const paths = ['/etc/x', 'C:\\x', 'a/../b', 'a\0b', '..'];
    expect(diffFacts(paths.map((p) => file(p, [hunk(p, 1, 1)])))).toEqual([]);
  });
  it('classifies roles and normalizes leading ./', () => {
    const facts = diffFacts([
      file('./src/a.ts', [hunk('x', 1, 1)]),
      file('src/a.test.ts', [hunk('x', 1, 1)]),
    ]);
    expect(facts[0]!.path).toBe('src/a.ts');
    expect(facts[0]!.role).toBe('core');
    expect(facts[1]!.role).toBe('tests');
  });
  it('never leaks raw text (sentinel in raw is unreachable)', () => {
    const d: UnifiedDiff = {
      raw: '@@ -1,1 +1,1 @@ SENTINEL_HDR\n+SENTINEL_BODY',
      files: [file('a.ts', [hunk('a.ts', 1, 1)])],
    };
    const out = JSON.stringify(diffFacts(d.files));
    expect(out).not.toContain('SENTINEL');
  });
});

describe('diffStats', () => {
  it('totals and by_role', () => {
    const facts = diffFacts([
      file('src/a.ts', [hunk('x', 1, 1)], 3, 1),
      file('src/b.ts', [hunk('x', 1, 1)], 2, 4),
      file('src/a.test.ts', [hunk('x', 1, 1)], 5, 0),
    ]);
    const s = diffStats(facts);
    expect(s).toMatchObject({ files: 3, additions: 10, deletions: 5 });
    expect(s.by_role).toEqual({ core: 2, tests: 1, wiring: 0, docs: 0, boilerplate: 0 });
  });
  it('is zeroed for no facts', () => {
    expect(diffStats([])).toEqual({
      files: 0,
      additions: 0,
      deletions: 0,
      by_role: { core: 0, tests: 0, wiring: 0, docs: 0, boilerplate: 0 },
    });
  });
});
