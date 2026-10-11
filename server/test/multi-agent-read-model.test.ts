import { describe, it, expect } from 'vitest';
import { MultiAgentRun } from '@devdigest/shared';
import {
  buildMultiAgentRun,
  type ChildRun,
  type ParentRun,
  type ReviewWithFindings,
} from '../src/modules/multi-agent/read-model.js';

const T0 = new Date('2026-01-01T10:00:00.000Z');
const parent: ParentRun = { id: 'ma1', prId: 'pr1', ranAt: T0 };

const child = (over: Partial<ChildRun> & { id: string }): ChildRun => ({
  agentId: `agent-${over.id}`,
  agentName: `Agent ${over.id}`,
  provider: 'openai',
  model: 'gpt',
  status: 'done',
  error: null,
  durationMs: 1000,
  costUsd: 0.1,
  score: 80,
  ranAt: T0,
  ...over,
});

const fnd = (id: string, over: Partial<ReviewWithFindings['findings'][number]> = {}) => ({
  id,
  file: 'src/a.ts',
  startLine: 10,
  endLine: 10,
  severity: 'WARNING',
  category: 'bug',
  title: 'Odd thing',
  kind: 'finding' as string | null,
  scope: null as 'in' | 'out' | 'signal' | null,
  ...over,
});

const rev = (
  runId: string,
  findings: ReviewWithFindings['findings'] = [],
  review: Partial<ReviewWithFindings['review']> = {},
): ReviewWithFindings => ({
  review: { runId, kind: 'review', verdict: 'comment', summary: `sum ${runId}`, score: 77, ...review },
  findings,
});

describe('buildMultiAgentRun', () => {
  it('done/failed/running columns carry every field and are ordered by agent name then run id', () => {
    const children = [
      child({ id: 'r3', agentName: 'Zed', status: 'running', durationMs: null, costUsd: null, score: null }),
      child({ id: 'r2', agentName: 'Alpha', status: 'failed', error: 'boom', durationMs: 50, costUsd: null, score: null }),
      child({ id: 'r1b', agentName: 'Alpha', status: 'done' }),
      child({ id: 'r1a', agentName: 'Alpha', status: 'done', score: null }),
    ];
    const run = buildMultiAgentRun(parent, 482, children, [rev('r1b', [fnd('f1')]), rev('r1a', [], { score: 66 })]);
    expect(() => MultiAgentRun.parse(run)).not.toThrow();
    expect(run).toMatchObject({ id: 'ma1', pr_id: 'pr1', pr_number: 482, agent_count: 4, ran_at: T0.toISOString() });
    expect(run.columns.map((c) => c.run_id)).toEqual(['r1a', 'r1b', 'r2', 'r3']);

    const done = run.columns.find((c) => c.run_id === 'r1b')!;
    expect(done).toMatchObject({
      agent_id: 'agent-r1b',
      agent_name: 'Alpha',
      provider: 'openai',
      model: 'gpt',
      status: 'done',
      error: null,
      verdict: 'comment',
      score: 80,
      summary: 'sum r1b',
      duration_ms: 1000,
      cost_usd: 0.1,
    });
    expect(done.findings).toHaveLength(1);
    // run score null -> falls back to the review score
    expect(run.columns.find((c) => c.run_id === 'r1a')!.score).toBe(66);

    const failed = run.columns.find((c) => c.run_id === 'r2')!;
    expect(failed).toMatchObject({ status: 'failed', error: 'boom', verdict: null, summary: null, findings: [] });
    const running = run.columns.find((c) => c.run_id === 'r3')!;
    expect(running).toMatchObject({ status: 'running', duration_ms: null, cost_usd: null, score: null });
  });

  it('maps unknown or null status to failed and keeps cancelled', () => {
    const run = buildMultiAgentRun(
      parent,
      1,
      [child({ id: 'a', status: null }), child({ id: 'b', status: 'weird' }), child({ id: 'c', status: 'cancelled' })],
      [],
    );
    expect(run.columns.map((c) => c.status)).toEqual(['failed', 'failed', 'cancelled']);
  });

  it('totals: cost sums known terminal costs (null column ignored, null when none); duration = latest terminal completion - parent ran_at; 0 when none terminal', () => {
    const at = (ms: number) => new Date(T0.getTime() + ms);
    const run = buildMultiAgentRun(
      parent,
      1,
      [
        child({ id: 'a', agentName: 'A', ranAt: at(100), durationMs: 2000, costUsd: 0.25 }),
        child({ id: 'b', agentName: 'B', ranAt: at(200), durationMs: 5000, costUsd: null }),
        child({ id: 'c', agentName: 'C', ranAt: at(0), durationMs: 1000, costUsd: 0.5, status: 'failed' }),
        // running: ignored for both totals
        child({ id: 'd', agentName: 'D', ranAt: at(0), durationMs: null, costUsd: 9, status: 'running' }),
      ],
      [],
    );
    expect(run.total_cost_usd).toBeCloseTo(0.75, 10);
    expect(run.total_duration_ms).toBe(5200); // b: 200 + 5000

    const noCost = buildMultiAgentRun(parent, 1, [child({ id: 'a', costUsd: null })], []);
    expect(noCost.total_cost_usd).toBeNull();

    const none = buildMultiAgentRun(
      parent,
      1,
      [child({ id: 'a', status: 'running', durationMs: null, costUsd: 1 })],
      [],
    );
    expect(none.total_duration_ms).toBe(0);
    expect(none.total_cost_usd).toBeNull();
  });

  it('every finding carries agent_id/agent_name/run_id of its review', () => {
    const run = buildMultiAgentRun(
      parent,
      1,
      [child({ id: 'r1', agentName: 'Alpha' }), child({ id: 'r2', agentName: 'Beta' })],
      [rev('r1', [fnd('f1', { startLine: 1, endLine: 2 })]), rev('r2', [fnd('f2', { file: 'src/z.ts' })])],
    );
    for (const c of run.columns) {
      expect(c.findings.length).toBeGreaterThan(0);
      for (const f of c.findings) {
        expect(f).toMatchObject({ agent_id: c.agent_id, agent_name: c.agent_name, run_id: c.run_id });
      }
    }
    const f1 = run.columns[0]!.findings[0]!;
    expect(f1).toMatchObject({ id: 'f1', start_line: 1, end_line: 2, severity: 'WARNING', category: 'bug' });
    // groups members keep attribution too
    for (const g of run.groups) for (const m of g.members) expect(m.run_id).toBeTruthy();
  });

  it('all children failed -> all columns failed, groups/conflicts empty', () => {
    const run = buildMultiAgentRun(
      parent,
      1,
      [
        child({ id: 'a', status: 'failed', error: 'x', durationMs: 0, costUsd: null }),
        child({ id: 'b', status: 'failed', error: 'x', durationMs: 0, costUsd: null }),
      ],
      [],
    );
    expect(run.columns.every((c) => c.status === 'failed')).toBe(true);
    expect(run.groups).toEqual([]);
    expect(run.conflicts).toEqual([]);
    expect(run.agent_count).toBe(2);
  });

  it('deleted agent -> agent_id null, agent_name "Deleted agent"', () => {
    const run = buildMultiAgentRun(
      parent,
      1,
      [child({ id: 'r1', agentId: null, agentName: null })],
      [rev('r1', [fnd('f1')])],
    );
    const c = run.columns[0]!;
    expect(c.agent_id).toBeNull();
    expect(c.agent_name).toBe('Deleted agent');
    expect(c.findings[0]).toMatchObject({ agent_id: null, agent_name: 'Deleted agent' });
    expect(() => MultiAgentRun.parse(run)).not.toThrow();
  });

  it('out-of-scope findings excluded (D-1)', () => {
    const run = buildMultiAgentRun(
      parent,
      1,
      [child({ id: 'r1' })],
      [
        rev('r1', [
          fnd('in1', { scope: 'in' }),
          fnd('out1', { scope: 'out', startLine: 50, endLine: 50 }),
          fnd('sig1', { scope: 'signal', startLine: 80, endLine: 80 }),
          fnd('legacy', { scope: null, startLine: 90, endLine: 90 }),
        ]),
      ],
    );
    expect(run.columns[0]!.findings.map((f) => f.id).sort()).toEqual(['in1', 'legacy', 'sig1']);
    expect(run.groups.flatMap((g) => g.members.map((m) => m.id))).not.toContain('out1');
  });

  it('prefers the review-kind row over the summary row for a run', () => {
    const run = buildMultiAgentRun(
      parent,
      1,
      [child({ id: 'r1' })],
      [rev('r1', [fnd('s1')], { kind: 'summary' }), rev('r1', [fnd('rv1')], { kind: 'review' })],
    );
    expect(run.columns[0]!.findings.map((f) => f.id)).toEqual(['rv1']);
  });

  it('groups come from done columns only and takes need two finished columns', () => {
    const run = buildMultiAgentRun(
      parent,
      1,
      [child({ id: 'r1', agentName: 'A' }), child({ id: 'r2', agentName: 'B', status: 'running', durationMs: null })],
      [rev('r1', [fnd('f1')]), rev('r2', [fnd('f2')])],
    );
    expect(run.groups).toHaveLength(1);
    expect(run.groups[0]!.members.map((m) => m.id)).toEqual(['f1']);
    expect(run.groups[0]!.takes).toEqual([]);
    expect(run.conflicts).toEqual([]);
  });
});
