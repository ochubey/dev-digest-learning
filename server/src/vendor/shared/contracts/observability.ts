import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * A5 — Observability / Multi-agent contracts (L07).
 *
 * These are NEW contracts (A5 owns this file; the barrel re-exports it). They
 * sit alongside A2's `review-api.ts`:
 *   - MultiAgentRun        the response of GET /multi-agent-runs/:id (and the
 *                          legacy POST /pulls/:id/multi-agent-run)
 *   - AgentColumn          one agent's column in the multi-agent view
 *   - FindingGroup         findings from several agents merged into one group
 *   - Conflict / ConflictTake  where agents disagree on the same file:line
 *   - AgentRunEstimate     per-agent duration/cost estimate (GET /multi-agent/estimates)
 *   - AgentStats           per-agent quality aggregates (GET /agents/:id/stats)
 *   - CuratorResult        the cross-session memory curator outcome
 *
 * The single-document run trace itself stays in `contracts/trace.ts` (RunTrace).
 */

// ---------------------------------------------------------------------------
// Multi-Agent Review
// ---------------------------------------------------------------------------

/** Which agent run produced a finding. `agent_id` is null for a deleted agent. */
export const FindingAttribution = z.object({
  agent_id: z.string().nullable(),
  agent_name: z.string(),
  run_id: z.string(),
});
export type FindingAttribution = z.infer<typeof FindingAttribution>;

/** A finding as surfaced in a multi-agent column (subset of FindingRecord) with its attribution. */
export const AgentColumnFinding = FindingAttribution.extend({
  id: z.string(),
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  kind: z.string().nullish(),
});
export type AgentColumnFinding = z.infer<typeof AgentColumnFinding>;

/** A finding attributed to the agent that produced it. */
export const AttributedFinding = AgentColumnFinding;
export type AttributedFinding = AgentColumnFinding;

/** One agent's result column in the multi-agent review. */
export const AgentColumn = z.object({
  run_id: z.string(),
  agent_id: z.string().nullable(),
  agent_name: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(['running', 'done', 'failed', 'cancelled']),
  error: z.string().nullable(),
  verdict: z.string().nullable(),
  score: z.number().int().nullable(),
  summary: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  findings: z.array(AttributedFinding),
});
export type AgentColumn = z.infer<typeof AgentColumn>;

/** One agent's stance on a contended file:line. */
export const ConflictTake = z.object({
  agent_id: z.string().nullable(),
  run_id: z.string(),
  persona: z.string(),
  /** Severity if the agent flagged it, or 'ignored' when it did not. */
  verdict: z.union([Severity, z.literal('ignored')]),
  note: z.string(),
});
export type ConflictTake = z.infer<typeof ConflictTake>;

/**
 * A conflict = a file:line that at least one agent flagged and at least one
 * other agent (that also reviewed) did NOT, OR where agents assigned divergent
 * severities. Computed from persisted findings; not stored.
 */
export const Conflict = z.object({
  file: z.string(),
  line: z.number().int(),
  title: z.string(),
  takes: z.array(ConflictTake),
});
export type Conflict = z.infer<typeof Conflict>;

/** Findings from one or more agents merged by file/line/title similarity. */
export const FindingGroup = z.object({
  id: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  members: z.array(AttributedFinding),
  takes: z.array(ConflictTake),
  is_conflict: z.boolean(),
});
export type FindingGroup = z.infer<typeof FindingGroup>;

/** Response of GET /multi-agent-runs/:id. */
export const MultiAgentRun = z.object({
  id: z.string(),
  pr_id: z.string(),
  pr_number: z.number().int().nullish(),
  ran_at: z.string(),
  agent_count: z.number().int(),
  total_duration_ms: z.number().int(),
  total_cost_usd: z.number().nullable(),
  columns: z.array(AgentColumn),
  conflicts: z.array(Conflict),
  groups: z.array(FindingGroup),
});
export type MultiAgentRun = z.infer<typeof MultiAgentRun>;

/** Estimate of one agent's run duration/cost from its recent done runs. */
export const AgentRunEstimate = z.object({
  agent_id: z.string(),
  sample_size: z.number().int(),
  avg_duration_ms: z.number().int().nullable(),
  avg_cost_usd: z.number().nullable(),
});
export type AgentRunEstimate = z.infer<typeof AgentRunEstimate>;

// ---------------------------------------------------------------------------
// Per-agent Stats (GET /agents/:id/stats)
// ---------------------------------------------------------------------------

/** A single (date, value) point for a sparkline/trend. */
export const StatPoint = z.object({ label: z.string(), value: z.number() });
export type StatPoint = z.infer<typeof StatPoint>;

export const AgentStats = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  runs: z.number().int(),
  findings_total: z.number().int(),
  /** accept-rate is the headline quality signal. 0..1 over acted findings (rated findings of counted runs only). */
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  accept_rate: z.number().nullable(),
  dismiss_rate: z.number().nullable(),
  avg_findings_per_run: z.number().nullable(),
  total_cost_usd: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  avg_latency_ms: z.number().nullable(),
  findings_by_severity: z.object({
    CRITICAL: z.number().int(),
    WARNING: z.number().int(),
    SUGGESTION: z.number().int(),
  }),
  /** One point per UTC day of the period (label `YYYY-MM-DD`, value = counted runs that day), oldest→newest. */
  trend: z.array(StatPoint),
  /** Applied period `[period_from, period_to)` as UTC ISO-8601 instants. */
  period_from: z.string(),
  period_to: z.string(),
  /** Non-done runs of this agent in the period; counted, never aggregated. */
  runs_excluded: z.number().int(),
  /** Counted runs with / without a recorded cost (a cost of 0 is a cost). */
  runs_with_cost: z.number().int(),
  runs_without_cost: z.number().int(),
  /** accepted + dismissed: the accept-rate denominator. */
  decisions: z.number().int(),
  /** decisions < 5: the rate is a weak signal. */
  low_sample: z.boolean(),
  /** Latest counted run in the period; null when none. */
  last_run_at: z.string().nullable(),
  /** Latest done run regardless of period; null = the agent never completed a run. */
  last_run_at_all_time: z.string().nullable(),
  /** Every cost in this object is a DevDigest estimate, not billing data. */
  cost_basis: z.literal('estimate'),
});
export type AgentStats = z.infer<typeof AgentStats>;

// ---------------------------------------------------------------------------
// Cross-session memory curator
// ---------------------------------------------------------------------------

/** A merge the curator performed (or would perform in dry-run). */
export const CuratorMerge = z.object({
  kept_id: z.string(),
  merged_ids: z.array(z.string()),
  content: z.string(),
  similarity: z.number(),
});
export type CuratorMerge = z.infer<typeof CuratorMerge>;

export const CuratorResult = z.object({
  scanned: z.number().int(),
  merges: z.array(CuratorMerge),
  removed: z.number().int(),
  dry_run: z.boolean(),
});
export type CuratorResult = z.infer<typeof CuratorResult>;

// ---------------------------------------------------------------------------
// Latest multi-agent run of a repo
// ---------------------------------------------------------------------------

/** `GET /multi-agent-runs/latest?repoId=` — newest multi-agent run id, or null. */
export const LatestMultiAgentRun = z.object({ id: z.string().nullable() });
export type LatestMultiAgentRun = z.infer<typeof LatestMultiAgentRun>;
