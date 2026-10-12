import { describe, it, expect } from 'vitest';
import { draftFromFinding } from '../src/modules/evals/draft.js';

const RAW = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' one',
  '+two',
  ' three',
  '',
].join('\n');

const finding = (over: Partial<{ title: string; start_line: number; end_line: number }> = {}) => ({
  id: 'f-1',
  pr_id: 'pr-1',
  title: 'Hardcoded Stripe key in config',
  file: 'src/a.ts',
  start_line: 2,
  end_line: 3,
  ...over,
});

describe('draftFromFinding', () => {
  it('accepted -> must_find, dismissed -> must_not_flag; file/start/end copied', () => {
    const acc = draftFromFinding({ finding: finding(), decision: 'accepted', rawDiff: RAW, agentId: 'ag-1', existing: [] });
    if (!('draft' in acc)) throw new Error('expected draft');
    expect(acc.draft.expectation).toEqual({ kind: 'must_find', file: 'src/a.ts', start_line: 2, end_line: 3 });
    expect(acc.draft).toMatchObject({ finding_id: 'f-1', pr_id: 'pr-1', agent_id: 'ag-1', origin: 'accepted_finding' });
    expect(acc.draft.input_diff).toContain('@@ -1,2 +1,3 @@');
    const dis = draftFromFinding({
      finding: finding(),
      decision: 'dismissed',
      rawDiff: RAW,
      agentId: null,
      existing: [{ agent_id: 'ag-2', case_id: 'c-1' }],
    });
    if (!('draft' in dis)) throw new Error('expected draft');
    expect(dis.draft.expectation.kind).toBe('must_not_flag');
    expect(dis.draft.origin).toBe('dismissed_finding');
    expect(dis.draft.agent_id).toBeNull();
    expect(dis.draft.existing_cases).toEqual([{ agent_id: 'ag-2', case_id: 'c-1' }]);
  });

  it('name slug <= 80 chars', () => {
    const r = draftFromFinding({
      finding: finding({ title: 'A very long Title! '.repeat(20) }),
      decision: 'accepted',
      rawDiff: RAW,
      agentId: null,
      existing: [],
    });
    if (!('draft' in r)) throw new Error('expected draft');
    expect(r.draft.name.length).toBeLessThanOrEqual(80);
    expect(r.draft.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const plain = draftFromFinding({ finding: finding(), decision: 'accepted', rawDiff: RAW, agentId: null, existing: [] });
    if (!('draft' in plain)) throw new Error('expected draft');
    expect(plain.draft.name).toBe('hardcoded-stripe-key-in-config');
  });

  it('refusal message text', () => {
    const r = draftFromFinding({
      finding: finding({ start_line: 90, end_line: 95 }),
      decision: 'accepted',
      rawDiff: RAW,
      agentId: null,
      existing: [],
    });
    expect(r).toEqual({
      error: 'finding_not_in_diff',
      message: "The finding's lines are no longer in the PR diff",
    });
  });
});
