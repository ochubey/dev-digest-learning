import { describe, it, expect } from 'vitest';
import { clampOutput, groundBrief } from '../src/modules/brief/grounding.js';
import type { BriefModelOutput } from '../src/modules/brief/schema.js';
import type { DiffFact } from '../src/modules/brief/diff-facts.js';
import {
  MAX_SUMMARY_CHARS,
  MAX_RISKS,
  MAX_EXPLANATION_CHARS,
  MAX_FOCUS_ITEMS,
  MAX_REASON_CHARS,
} from '../src/modules/brief/constants.js';

const fact = (path: string, ranges: [number, number][] = [[1, 100]]): DiffFact => ({
  path,
  role: 'core',
  additions: 1,
  deletions: 0,
  ranges,
});
const ctx = (facts: DiffFact[], blast: string[] = []) => ({
  diff: new Map(facts.map((f) => [f.path, f])),
  blastFiles: new Set(blast),
});
const risk = (file_refs: string[], over: Record<string, unknown> = {}) => ({
  kind: 'correctness' as const,
  title: 't',
  explanation: 'e',
  severity: 'medium' as const,
  file_refs,
  ...over,
});
const out = (
  risks: BriefModelOutput['risks'] = [],
  review_focus: BriefModelOutput['review_focus'] = [],
): BriefModelOutput => ({ summary: 's', risks, review_focus });
const focus = (file: string, line: number, reason = 'r') => ({ file, line, reason });
const ZERO = { dropped_risks: 0, dropped_refs: 0, dropped_focus: 0, adjusted_lines: 0 };

describe('groundBrief risks', () => {
  it('keeps the valid ref, drops the invented one', () => {
    const g = groundBrief(out([risk(['src/a.ts', 'src/invented.ts'])]), ctx([fact('src/a.ts')]));
    expect(g.risks).toHaveLength(1);
    expect(g.risks[0]!.file_refs).toEqual(['src/a.ts']);
    expect(g.counts).toEqual({ ...ZERO, dropped_refs: 1 });
  });

  it('drops a risk whose refs are all invalid', () => {
    const g = groundBrief(out([risk(['x.ts', 'y.ts'])]), ctx([fact('src/a.ts')]));
    expect(g.risks).toEqual([]);
    expect(g.counts).toEqual({ ...ZERO, dropped_risks: 1, dropped_refs: 2 });
  });

  it('accepts blast caller files as risk refs, but not as focus files', () => {
    const c = ctx([fact('src/a.ts')], ['src/caller.ts']);
    const g = groundBrief(out([risk(['src/caller.ts'])], [focus('src/caller.ts', 3)]), c);
    expect(g.risks[0]!.file_refs).toEqual(['src/caller.ts']);
    expect(g.review_focus).toEqual([]);
    expect(g.counts.dropped_focus).toBe(1);
  });

  it('every surviving risk has at least one ref', () => {
    const g = groundBrief(
      out([risk(['a.ts']), risk(['nope']), risk([]), risk(['a.ts', 'b'])]),
      ctx([fact('a.ts')]),
    );
    expect(g.risks.length).toBe(2);
    for (const r of g.risks) expect(r.file_refs.length).toBeGreaterThanOrEqual(1);
    expect(g.counts.dropped_risks).toBe(2);
  });

  it('matching is case-sensitive', () => {
    const g = groundBrief(out([risk(['SRC/A.ts'])], [focus('SRC/A.ts', 5)]), ctx([fact('src/A.ts')]));
    expect(g.risks).toEqual([]);
    expect(g.review_focus).toEqual([]);
  });

  it('matches ./src/a.ts and STORES the allow-list key src/a.ts', () => {
    const g = groundBrief(out([risk(['./src/a.ts'])], [focus('./src/a.ts', 5)]), ctx([fact('src/a.ts')]));
    expect(g.risks[0]!.file_refs).toEqual(['src/a.ts']);
    expect(g.review_focus[0]!.file).toBe('src/a.ts');
  });

  it('dedupes refs that canonicalize to the same key', () => {
    const g = groundBrief(out([risk(['./src/a.ts', 'src/a.ts'])]), ctx([fact('src/a.ts')]));
    expect(g.risks[0]!.file_refs).toEqual(['src/a.ts']);
  });

  it('drops and counts unsafe paths', () => {
    const bad = ['/etc/x', 'C:\\x', 'a/../b', 'a\0b'];
    const g = groundBrief(
      out([risk(['ok.ts', ...bad])], bad.map((p) => focus(p, 1))),
      ctx([fact('ok.ts'), fact('/etc/x'), fact('a/../b')], ['/etc/x']),
    );
    expect(g.risks[0]!.file_refs).toEqual(['ok.ts']);
    expect(g.review_focus).toEqual([]);
    expect(g.counts.dropped_refs).toBe(4);
    expect(g.counts.dropped_focus).toBe(4);
  });

  it('drops deleted-file and binary-file refs (not in facts) and the old rename path', () => {
    const c = ctx([fact('src/new-name.ts')]);
    const g = groundBrief(
      out(
        [risk(['deleted.ts', 'img.png', 'src/old-name.ts', 'src/new-name.ts'])],
        [focus('deleted.ts', 1), focus('src/old-name.ts', 1), focus('src/new-name.ts', 1)],
      ),
      c,
    );
    expect(g.risks[0]!.file_refs).toEqual(['src/new-name.ts']);
    expect(g.review_focus.map((f) => f.file)).toEqual(['src/new-name.ts']);
    expect(g.counts).toEqual({ ...ZERO, dropped_refs: 3, dropped_focus: 2 });
  });
});

describe('groundBrief focus and line snapping', () => {
  const c = ctx([fact('a.ts', [[10, 20], [50, 60]])]);

  it('snaps to the nearest hunk start, ties go to the earlier hunk, in-range is kept', () => {
    const g = groundBrief(out([], [focus('a.ts', 35), focus('a.ts', 30), focus('a.ts', 15)]), c);
    expect(g.review_focus).toEqual([
      { file: 'a.ts', line: 50, reason: 'r', line_adjusted: true },
      { file: 'a.ts', line: 10, reason: 'r', line_adjusted: true },
      { file: 'a.ts', line: 15, reason: 'r' },
    ]);
    expect('line_adjusted' in g.review_focus[2]!).toBe(false);
    expect(g.counts.adjusted_lines).toBe(2);
  });

  it('a line that snaps to a start equal to itself is not marked adjusted', () => {
    const g = groundBrief(out([], [focus('a.ts', 50)]), c);
    expect(g.review_focus).toEqual([{ file: 'a.ts', line: 50, reason: 'r' }]);
    expect(g.counts.adjusted_lines).toBe(0);
  });

  it('rejects lines below 1', () => {
    const g = groundBrief(out([], [focus('a.ts', 0), focus('a.ts', -5)]), c);
    expect(g.review_focus).toEqual([]);
    expect(g.counts.dropped_focus).toBe(2);
  });

  it('dedupes file:line after snapping (first wins)', () => {
    const g = groundBrief(out([], [focus('a.ts', 35, 'first'), focus('a.ts', 51, 'second'), focus('a.ts', 55, 'third')]), c);
    // 35 -> 50 (adjusted), 51 in range, 55 in range
    expect(g.review_focus.map((f) => [f.line, f.reason])).toEqual([
      [50, 'first'],
      [51, 'second'],
      [55, 'third'],
    ]);
    const d = groundBrief(out([], [focus('a.ts', 35, 'first'), focus('a.ts', 40, 'dup')]), c);
    expect(d.review_focus).toHaveLength(1);
    expect(d.review_focus[0]!.reason).toBe('first');
    expect(d.counts.dropped_focus).toBe(1);
  });

  it('ignores a model-supplied line_adjusted', () => {
    const withFlag = { ...focus('a.ts', 15), line_adjusted: true } as never;
    const g = groundBrief(out([], [withFlag]), c);
    expect(g.review_focus).toEqual([{ file: 'a.ts', line: 15, reason: 'r' }]);
    expect('line_adjusted' in g.review_focus[0]!).toBe(false);
  });
});

describe('clampOutput and caps', () => {
  it('enforces summary 600, 8 risks, explanation 400, 7 focus items, reason 200', () => {
    const o = clampOutput({
      summary: 's'.repeat(MAX_SUMMARY_CHARS + 50),
      risks: Array.from({ length: 12 }, () => risk(['a.ts'], { explanation: 'e'.repeat(MAX_EXPLANATION_CHARS + 50) })),
      review_focus: Array.from({ length: 12 }, (_, i) => focus('a.ts', i + 1, 'r'.repeat(MAX_REASON_CHARS + 50))),
    });
    expect(o.summary).toHaveLength(MAX_SUMMARY_CHARS);
    expect(o.risks).toHaveLength(MAX_RISKS);
    expect(o.risks[0]!.explanation).toHaveLength(MAX_EXPLANATION_CHARS);
    expect(o.review_focus).toHaveLength(MAX_FOCUS_ITEMS);
    expect(o.review_focus[0]!.reason).toHaveLength(MAX_REASON_CHARS);
  });

  it('does not mutate its input', () => {
    const input = out([risk(['a.ts'])], [focus('a.ts', 1)]);
    const copy = JSON.parse(JSON.stringify(input));
    clampOutput(input);
    expect(input).toEqual(copy);
  });

  it('groundBrief output never exceeds the caps either', () => {
    const g = groundBrief(
      out(
        Array.from({ length: 12 }, () => risk(['a.ts'])),
        Array.from({ length: 12 }, (_, i) => focus('a.ts', i + 1)),
      ),
      ctx([fact('a.ts')]),
    );
    expect(g.risks).toHaveLength(MAX_RISKS);
    expect(g.review_focus).toHaveLength(MAX_FOCUS_ITEMS);
  });
});
