import { describe, it, expect } from 'vitest';
import type { AttributedFinding } from '@devdigest/shared';
import { applyTakes, conflictsOf, groupFindings } from '../src/modules/multi-agent/grouping.js';

let n = 0;
const fi = (over: Partial<AttributedFinding> = {}): AttributedFinding => ({
  id: `f${String(++n).padStart(3, '0')}`,
  severity: 'WARNING',
  category: 'bug',
  title: 'Something odd here',
  file: 'src/a.ts',
  start_line: 10,
  end_line: 10,
  kind: 'finding',
  agent_id: 'ag1',
  agent_name: 'Alpha',
  run_id: 'run1',
  ...over,
});

const col = (run_id: string, agent_name: string) => ({ run_id, agent_id: `id-${run_id}`, agent_name });

describe('groupFindings', () => {
  it('same file + overlapping lines + equal category -> one group', () => {
    const a = fi({ start_line: 10, end_line: 14, title: 'aaa' });
    const b = fi({ start_line: 12, end_line: 12, title: 'zzz', agent_name: 'Beta', run_id: 'run2' });
    const groups = groupFindings([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('same lines, different file -> separate', () => {
    const groups = groupFindings([fi({ file: 'a.ts' }), fi({ file: 'b.ts' })]);
    expect(groups).toHaveLength(2);
  });

  it('4 lines apart -> separate; 3 apart -> grouped', () => {
    const base = fi({ start_line: 10, end_line: 10 });
    const far = fi({ start_line: 14, end_line: 14 });
    const near = fi({ start_line: 13, end_line: 13 });
    expect(groupFindings([base, far])).toHaveLength(2);
    expect(groupFindings([base, near])).toHaveLength(1);
  });

  it('different category, title Jaccard >= 0.5 -> grouped', () => {
    const a = fi({ category: 'bug', title: 'Missing null check on user input' });
    const b = fi({ category: 'security', title: 'Missing null check on input' });
    expect(groupFindings([a, b])).toHaveLength(1);
    const c = fi({ category: 'security', title: 'Totally unrelated wording' });
    expect(groupFindings([a, c])).toHaveLength(2);
  });

  it('transitive A-B-C -> one group', () => {
    const a = fi({ start_line: 10, end_line: 10 });
    const b = fi({ start_line: 13, end_line: 13 });
    const c = fi({ start_line: 16, end_line: 16 }); // 6 from A, 3 from B
    expect(groupFindings([a, c])).toHaveLength(2);
    const groups = groupFindings([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.members).toHaveLength(3);
  });

  it('shuffled input -> identical output', () => {
    const items = [
      fi({ start_line: 1, end_line: 2, agent_name: 'B', title: 'one thing' }),
      fi({ start_line: 3, end_line: 3, agent_name: 'A', severity: 'CRITICAL', title: 'two thing' }),
      fi({ start_line: 40, end_line: 41, agent_name: 'C', category: 'perf', title: 'slow loop' }),
      fi({ file: 'src/b.ts', start_line: 5, end_line: 5, agent_name: 'A' }),
      fi({ file: 'src/b.ts', start_line: 7, end_line: 7, agent_name: 'B' }),
      fi({ start_line: 41, end_line: 41, agent_name: 'A', category: 'perf' }),
    ];
    const expected = JSON.stringify(groupFindings(items));
    const reversed = [...items].reverse();
    const rotated = [...items.slice(2), ...items.slice(0, 2)];
    expect(JSON.stringify(groupFindings(reversed))).toBe(expected);
    expect(JSON.stringify(groupFindings(rotated))).toBe(expected);
  });

  it('group fields: id stable, file, start/end span, title of most severe (tie by agent name), members unchanged', () => {
    const w = fi({ id: 'f-b', severity: 'WARNING', title: 'warn title', start_line: 10, end_line: 12, agent_name: 'Zed', run_id: 'r2' });
    const cb = fi({ id: 'f-c', severity: 'CRITICAL', title: 'crit from Beta', start_line: 11, end_line: 15, agent_name: 'Beta', run_id: 'r3' });
    const ca = fi({ id: 'f-a', severity: 'CRITICAL', title: 'crit from Alpha', start_line: 12, end_line: 13, agent_name: 'Alpha', run_id: 'r1' });
    const [g] = groupFindings([w, cb, ca]);
    expect(g!.id).toBe('grp_f-a');
    expect(g!.file).toBe('src/a.ts');
    expect(g!.start_line).toBe(10);
    expect(g!.end_line).toBe(15);
    expect(g!.title).toBe('crit from Alpha');
    expect(g!.members).toEqual([ca, cb, w]); // by agent name, members untouched
    expect(g!.takes).toEqual([]);
    expect(g!.is_conflict).toBe(false);
    // stable for the same input
    expect(groupFindings([ca, w, cb])[0]!.id).toBe('grp_f-a');
  });
});

describe('applyTakes', () => {
  const alpha = col('r1', 'Alpha');
  const beta = col('r2', 'Beta');
  const gamma = col('r3', 'Gamma');

  it('3 done columns, group flagged by 2 -> 3 takes, one ignored with empty note', () => {
    const a = fi({ run_id: 'r1', agent_name: 'Alpha', title: 'alpha title' });
    const b = fi({ run_id: 'r2', agent_name: 'Beta', title: 'beta title' });
    const groups = applyTakes(groupFindings([a, b]), [gamma, beta, alpha]);
    expect(groups).toHaveLength(1);
    const takes = groups[0]!.takes;
    expect(takes).toHaveLength(3);
    expect(takes.map((t) => t.persona)).toEqual(['Alpha', 'Beta', 'Gamma']);
    const g = takes.find((t) => t.persona === 'Gamma')!;
    expect(g.verdict).toBe('ignored');
    expect(g.note).toBe('');
    expect(takes.find((t) => t.persona === 'Alpha')).toMatchObject({ verdict: 'WARNING', note: 'alpha title', run_id: 'r1' });
  });

  it('one failed column -> 2 takes', () => {
    // the failed column is simply not passed in as finished
    const a = fi({ run_id: 'r1', agent_name: 'Alpha' });
    const groups = applyTakes(groupFindings([a]), [alpha, beta]);
    expect(groups[0]!.takes).toHaveLength(2);
  });

  it('all WARNING -> not conflict; WARNING vs SUGGESTION -> conflict; one ignored -> conflict; conflicts == conflict subset', () => {
    const same = applyTakes(
      groupFindings([fi({ run_id: 'r1', agent_name: 'Alpha' }), fi({ run_id: 'r2', agent_name: 'Beta' })]),
      [alpha, beta],
    );
    expect(same[0]!.is_conflict).toBe(false);

    const diff = applyTakes(
      groupFindings([
        fi({ run_id: 'r1', agent_name: 'Alpha', severity: 'WARNING' }),
        fi({ run_id: 'r2', agent_name: 'Beta', severity: 'SUGGESTION' }),
      ]),
      [alpha, beta],
    );
    expect(diff[0]!.is_conflict).toBe(true);

    const ignored = applyTakes(groupFindings([fi({ run_id: 'r1', agent_name: 'Alpha' })]), [alpha, beta]);
    expect(ignored[0]!.is_conflict).toBe(true);

    const all = applyTakes(
      groupFindings([
        fi({ file: 'a.ts', run_id: 'r1', agent_name: 'Alpha' }),
        fi({ file: 'a.ts', run_id: 'r2', agent_name: 'Beta' }),
        fi({ file: 'b.ts', run_id: 'r1', agent_name: 'Alpha', title: 'only alpha' }),
      ]),
      [alpha, beta],
    );
    const conflicts = conflictsOf(all);
    const expected = all.filter((g) => g.is_conflict);
    expect(expected).toHaveLength(1);
    expect(conflicts).toEqual(
      expected.map((g) => ({ file: g.file, line: g.start_line, title: g.title, takes: g.takes })),
    );
  });

  it('one done + one running -> no takes, is_conflict false, conflicts []', () => {
    // only the done column counts as finished
    const groups = applyTakes(groupFindings([fi({ run_id: 'r1', agent_name: 'Alpha' })]), [alpha]);
    expect(groups[0]!.takes).toEqual([]);
    expect(groups[0]!.is_conflict).toBe(false);
    expect(conflictsOf(groups)).toEqual([]);
  });

  it('same agent twice on same lines -> both members, take uses most severe', () => {
    const low = fi({ run_id: 'r1', agent_name: 'Alpha', severity: 'SUGGESTION', title: 'low' });
    const high = fi({ run_id: 'r1', agent_name: 'Alpha', severity: 'CRITICAL', title: 'high' });
    const [g] = applyTakes(groupFindings([low, high]), [alpha, beta]);
    expect(g!.members).toHaveLength(2);
    const t = g!.takes.find((x) => x.run_id === 'r1')!;
    expect(t.verdict).toBe('CRITICAL');
    expect(t.note).toBe('high');
  });
});
