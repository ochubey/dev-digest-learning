import type { AgentColumn, AttributedFinding, MultiAgentRun } from '@devdigest/shared';
import { isVisibleScope } from '../reviews/scope-visibility.js';
import { DELETED_AGENT_NAME } from './constants.js';
import { applyTakes, conflictsOf, groupFindings } from './grouping.js';

/** Pure assembly of the MultiAgentRun read model from persisted rows. */

export interface ChildRun {
  id: string;
  agentId: string | null;
  /** Null when the agent row is gone. */
  agentName: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  error: string | null;
  durationMs: number | null;
  costUsd: number | null;
  score: number | null;
  ranAt: Date;
}

export interface ReviewWithFindings {
  review: {
    runId: string | null;
    kind: string;
    verdict: string | null;
    summary: string | null;
    score: number | null;
  };
  findings: {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    severity: string;
    category: string;
    title: string;
    kind: string | null;
    scope: 'in' | 'out' | 'signal' | null;
  }[];
}

export interface ParentRun {
  id: string;
  prId: string;
  ranAt: Date;
}

export function mapStatus(status: string | null): AgentColumn['status'] {
  return status === 'running' || status === 'done' || status === 'failed' || status === 'cancelled'
    ? status
    : 'failed';
}

export function toColumn(run: ChildRun, review: ReviewWithFindings | undefined): AgentColumn {
  const agent_name = run.agentName ?? DELETED_AGENT_NAME;
  const findings: AttributedFinding[] = (review?.findings ?? [])
    .filter((f) => isVisibleScope(f.scope))
    .map((f) => ({
      id: f.id,
      severity: f.severity as AttributedFinding['severity'],
      category: f.category,
      title: f.title,
      file: f.file,
      start_line: f.startLine,
      end_line: f.endLine,
      kind: f.kind,
      agent_id: run.agentId,
      agent_name,
      run_id: run.id,
    }));
  return {
    run_id: run.id,
    agent_id: run.agentId,
    agent_name,
    provider: run.provider,
    model: run.model,
    status: mapStatus(run.status),
    error: run.error,
    verdict: review?.review.verdict ?? null,
    score: run.score ?? review?.review.score ?? null,
    summary: review?.review.summary ?? null,
    duration_ms: run.durationMs,
    cost_usd: run.costUsd,
    findings,
  };
}

/** Cost = sum of known terminal costs (null when none); duration = latest terminal completion - parent start. */
export function totals(
  parentRanAt: Date,
  items: { column: AgentColumn; ranAt: Date }[],
): { total_duration_ms: number; total_cost_usd: number | null } {
  const terminal = items.filter((i) => i.column.status !== 'running');
  const costs = terminal.flatMap((i) => (i.column.cost_usd == null ? [] : [i.column.cost_usd]));
  const ends = terminal.map((i) => i.ranAt.getTime() + (i.column.duration_ms ?? 0));
  return {
    total_duration_ms: ends.length === 0 ? 0 : Math.max(0, Math.round(Math.max(...ends) - parentRanAt.getTime())),
    total_cost_usd: costs.length === 0 ? null : costs.reduce((s, c) => s + c, 0),
  };
}

export function buildMultiAgentRun(
  parent: ParentRun,
  prNumber: number | null,
  children: ChildRun[],
  reviews: ReviewWithFindings[],
): MultiAgentRun {
  // One review per run: prefer kind 'review' over 'summary'.
  const byRun = new Map<string, ReviewWithFindings>();
  for (const r of reviews) {
    const id = r.review.runId;
    if (!id) continue;
    const prev = byRun.get(id);
    if (!prev || (prev.review.kind !== 'review' && r.review.kind === 'review')) byRun.set(id, r);
  }

  const items = children
    .map((run) => ({ column: toColumn(run, byRun.get(run.id)), ranAt: run.ranAt }))
    .sort((a, b) => a.column.agent_name.localeCompare(b.column.agent_name) || a.column.run_id.localeCompare(b.column.run_id));
  const columns = items.map((i) => i.column);

  // Groups are built from done columns only.
  const done = columns.filter((c) => c.status === 'done');
  const groups = applyTakes(
    groupFindings(done.flatMap((c) => c.findings)),
    done.map((c) => ({ run_id: c.run_id, agent_id: c.agent_id, agent_name: c.agent_name })),
  );

  return {
    id: parent.id,
    pr_id: parent.prId,
    pr_number: prNumber,
    ran_at: parent.ranAt.toISOString(),
    agent_count: columns.length,
    ...totals(parent.ranAt, items),
    columns,
    conflicts: conflictsOf(groups),
    groups,
  };
}
