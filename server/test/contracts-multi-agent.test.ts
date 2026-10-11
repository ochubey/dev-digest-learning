import { describe, it, expect } from 'vitest';
import { MultiAgentRun, RunRequest, ReviewRunResponse, AgentRunEstimate } from '@devdigest/shared';

const finding = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  severity: 'WARNING',
  category: 'bug',
  title: 'Null deref',
  file: 'src/a.ts',
  start_line: 10,
  end_line: 12,
  kind: 'finding',
  agent_id: 'ag1',
  agent_name: 'Security',
  run_id: 'run1',
  ...over,
});

const take = (over: Record<string, unknown> = {}) => ({
  agent_id: 'ag1',
  run_id: 'run1',
  persona: 'Security',
  verdict: 'WARNING',
  note: 'Null deref',
  ...over,
});

const column = (over: Record<string, unknown> = {}) => ({
  run_id: 'run1',
  agent_id: 'ag1',
  agent_name: 'Security',
  provider: 'openai',
  model: 'gpt',
  status: 'done',
  error: null,
  verdict: 'comment',
  score: 80,
  summary: 's',
  duration_ms: 1200,
  cost_usd: 0.1,
  findings: [finding()],
  ...over,
});

describe('multi-agent contracts', () => {
  it('parses a sample MultiAgentRun with columns, groups and conflicts', () => {
    const sample = {
      id: 'ma1',
      pr_id: 'pr1',
      pr_number: 482,
      ran_at: new Date().toISOString(),
      agent_count: 2,
      total_duration_ms: 3000,
      total_cost_usd: 0.3,
      columns: [
        column(),
        column({ run_id: 'run2', agent_id: null, agent_name: 'Deleted agent', status: 'failed', error: 'boom', findings: [] }),
      ],
      conflicts: [
        { file: 'src/a.ts', line: 10, title: 'Null deref', takes: [take(), take({ run_id: 'run2', agent_id: null, verdict: 'ignored', note: '' })] },
      ],
      groups: [
        {
          id: 'grp_f1',
          file: 'src/a.ts',
          start_line: 10,
          end_line: 12,
          title: 'Null deref',
          members: [finding()],
          takes: [take(), take({ run_id: 'run2', verdict: 'ignored', note: '' })],
          is_conflict: true,
        },
      ],
    };
    const parsed = MultiAgentRun.parse(sample);
    expect(parsed.groups[0]!.is_conflict).toBe(true);
    expect(parsed.columns[1]!.agent_id).toBeNull();
    expect(parsed.columns.map((c) => c.status)).toEqual(['done', 'failed']);
  });

  it('accepts the cancelled status and rejects an unknown one', () => {
    expect(() => MultiAgentRun.shape.columns.element.parse(column({ status: 'cancelled' }))).not.toThrow();
    expect(() => MultiAgentRun.shape.columns.element.parse(column({ status: 'weird' }))).toThrow();
  });

  it('parses an AgentRunEstimate with null averages', () => {
    expect(
      AgentRunEstimate.parse({ agent_id: 'a', sample_size: 0, avg_duration_ms: null, avg_cost_usd: null }),
    ).toMatchObject({ sample_size: 0 });
  });

  it('old-shape RunRequest ({agentId}, {all:true}, {}) still parses', () => {
    expect(RunRequest.parse({ agentId: 'a' })).toEqual({ agentId: 'a' });
    expect(RunRequest.parse({ all: true })).toEqual({ all: true });
    expect(RunRequest.parse({})).toEqual({});
  });

  it('agentIds accepts 1..5 distinct ids', () => {
    expect(RunRequest.parse({ agentIds: ['a'] }).agentIds).toEqual(['a']);
    expect(RunRequest.parse({ agentIds: ['a', 'b', 'c', 'd', 'e'] }).agentIds).toHaveLength(5);
  });

  it('agentIds [] / 6 ids / duplicates rejected', () => {
    expect(RunRequest.safeParse({ agentIds: [] }).success).toBe(false);
    expect(RunRequest.safeParse({ agentIds: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false);
    expect(RunRequest.safeParse({ agentIds: ['a', 'a'] }).success).toBe(false);
    expect(RunRequest.safeParse({ agentIds: [''] }).success).toBe(false);
  });

  it('ReviewRunResponse: multi_agent_run_id is optional', () => {
    const base = { pr_id: 'p', runs: [], reviews: [] };
    expect(ReviewRunResponse.safeParse(base).success).toBe(true);
    expect(ReviewRunResponse.parse({ ...base, multi_agent_run_id: 'm' }).multi_agent_run_id).toBe('m');
  });
});
