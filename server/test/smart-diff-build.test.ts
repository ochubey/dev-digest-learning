/**
 * Pure Smart Diff assembly (`modules/reviews/smart-diff/build.ts`): grouping by
 * role in GROUP_ORDER, finding-line dots, and the "latest review per agent"
 * selection. No HTTP, no DB.
 */
import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import {
  buildSmartDiff,
  latestFindingsPerAgent,
  type SmartDiffFindingInput,
} from '../src/modules/reviews/smart-diff/build.js';
import { GROUP_ORDER } from '../src/modules/reviews/smart-diff/constants.js';

const f = (path: string, additions = 1, deletions = 0) => ({ path, additions, deletions });
const fi = (
  file: string,
  startLine: number,
  extra: Partial<SmartDiffFindingInput> = {},
): SmartDiffFindingInput => ({ file, startLine, dismissedAt: null, scope: null, ...extra });

describe('buildSmartDiff', () => {
  it('orders groups by GROUP_ORDER and omits empty groups', () => {
    const out = buildSmartDiff(
      [f('pnpm-lock.yaml'), f('README.md'), f('src/a.ts'), f('test/a.test.ts')],
      [],
    );
    const roles = out.groups.map((g) => g.role);
    expect(roles).toEqual(GROUP_ORDER.filter((r) => roles.includes(r)));
    expect(roles).not.toContain('wiring');
    expect(roles).toContain('core');
    expect(roles).toContain('tests');
    expect(roles).toContain('docs');
    expect(roles).toContain('boilerplate');
  });

  it('sorts files by path inside a group', () => {
    const out = buildSmartDiff([f('src/z.ts'), f('src/a.ts'), f('src/m.ts')], []);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]!.files.map((x) => x.path)).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('finding_lines are unique and ascending, per file only', () => {
    const out = buildSmartDiff(
      [f('src/a.ts'), f('src/b.ts')],
      [fi('src/a.ts', 30), fi('src/a.ts', 5), fi('src/a.ts', 30), fi('src/b.ts', 9)],
    );
    const files = out.groups[0]!.files;
    expect(files.find((x) => x.path === 'src/a.ts')!.finding_lines).toEqual([5, 30]);
    expect(files.find((x) => x.path === 'src/b.ts')!.finding_lines).toEqual([9]);
  });

  it('excludes dismissed findings and scope "out"; keeps "in" and "signal"', () => {
    const out = buildSmartDiff(
      [f('src/a.ts')],
      [
        fi('src/a.ts', 1, { dismissedAt: new Date() }),
        fi('src/a.ts', 2, { scope: 'out' }),
        fi('src/a.ts', 3, { scope: 'in' }),
        fi('src/a.ts', 4, { scope: 'signal' }),
        fi('src/a.ts', 5),
      ],
    );
    expect(out.groups[0]!.files[0]!.finding_lines).toEqual([3, 4, 5]);
  });

  it('zero findings gives empty finding_lines', () => {
    const out = buildSmartDiff([f('src/a.ts')], []);
    expect(out.groups[0]!.files[0]!.finding_lines).toEqual([]);
  });

  it('ignores findings for files not in the PR', () => {
    const out = buildSmartDiff([f('src/a.ts')], [fi('src/other.ts', 3)]);
    expect(out.groups[0]!.files.map((x) => x.path)).toEqual(['src/a.ts']);
    expect(out.groups[0]!.files[0]!.finding_lines).toEqual([]);
  });

  it('split_suggestion sums additions+deletions and is otherwise inert', () => {
    const out = buildSmartDiff([f('src/a.ts', 10, 5), f('README.md', 2, 3)], []);
    expect(out.split_suggestion).toEqual({ too_big: false, total_lines: 20, proposed_splits: [] });
  });

  it('no files gives no groups and zero total', () => {
    const out = buildSmartDiff([], []);
    expect(out).toEqual({
      groups: [],
      split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
    });
  });

  it('output parses with the SmartDiff contract', () => {
    const out = buildSmartDiff([f('src/a.ts', 3, 1), f('docs/x.md')], [fi('src/a.ts', 2)]);
    expect(SmartDiff.safeParse(out).success).toBe(true);
  });
});

describe('latestFindingsPerAgent', () => {
  const rv = (
    id: string,
    agentId: string | null,
    kind: 'review' | 'summary',
    createdAt: number,
    findings: SmartDiffFindingInput[],
  ) => ({
    review: { id, agentId, kind, createdAt: new Date(createdAt) },
    findings,
  });

  it('takes only the newest review of each agent and unions them', () => {
    const out = latestFindingsPerAgent([
      rv('r1', 'A', 'review', 1000, [fi('a.ts', 1)]),
      rv('r2', 'A', 'review', 2000, [fi('a.ts', 2)]),
      rv('r3', 'B', 'review', 500, [fi('b.ts', 3)]),
    ]);
    expect(out.map((x) => x.startLine).sort()).toEqual([2, 3]);
  });

  it('ignores kind "summary" reviews', () => {
    const out = latestFindingsPerAgent([
      rv('r1', 'A', 'review', 1000, [fi('a.ts', 1)]),
      rv('r2', 'A', 'summary', 5000, [fi('a.ts', 9)]),
    ]);
    expect(out.map((x) => x.startLine)).toEqual([1]);
  });

  it('is empty with no reviews', () => {
    expect(latestFindingsPerAgent([])).toEqual([]);
  });
});
