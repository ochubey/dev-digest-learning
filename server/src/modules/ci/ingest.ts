import { CiResultArtifact } from '@devdigest/shared';
import type { ActionsRun } from './ports.js';

export interface IngestInstallation {
  id: string;
  agentId: string;
  workspaceId: string;
  agentName: string;
  repo: string;
  githubRepoId: number | null;
  workflowVersion: number | null;
}

export type IngestRule =
  | 'schema_invalid'
  | 'commit_sha_mismatch'
  | 'repository_id_mismatch'
  | 'pr_number_mismatch';

export type ValidationResult = { ok: true; artifact: CiResultArtifact } | { ok: false; rule: IngestRule };

/** Schema-validates an artifact (unknown keys stripped) and cross-checks it with GitHub's run metadata (AC-58..AC-61). */
export function validateArtifact(
  json: unknown,
  run: ActionsRun,
  inst: Pick<IngestInstallation, 'githubRepoId'>,
): ValidationResult {
  const parsed = CiResultArtifact.safeParse(json);
  if (!parsed.success) return { ok: false, rule: 'schema_invalid' };
  const a = parsed.data;
  if (!a.commit_sha || a.commit_sha !== run.head_sha) return { ok: false, rule: 'commit_sha_mismatch' };
  if (
    a.repository_id == null ||
    a.repository_id !== run.repository_id ||
    (inst.githubRepoId != null && a.repository_id !== inst.githubRepoId)
  ) {
    return { ok: false, rule: 'repository_id_mismatch' };
  }
  if (run.pull_requests.length > 0 && (a.pr_number == null || !run.pull_requests.includes(a.pr_number))) {
    return { ok: false, rule: 'pr_number_mismatch' };
  }
  return { ok: true, artifact: a };
}

/** AC-66: the status reflects findings, not the gate. */
export const statusFor = (a: Pick<CiResultArtifact, 'findings_count'>): 'no_findings' | 'succeeded' =>
  a.findings_count === 0 ? 'no_findings' : 'succeeded';

export const NO_ARTIFACT_REASON = 'No result artifact (the job failed before producing a result)';
export const rejectedReason = (rule: string): string => `Result rejected: ${rule}`;

/** Values for a `ci_runs` insert. */
export interface CiRunValues {
  ciInstallationId: string;
  workspaceId: string;
  agentId: string;
  agentName: string;
  githubRunId: number;
  repo: string;
  prNumber: number | null;
  prTitle: string | null;
  commitSha: string | null;
  ranAt: Date | null;
  status: 'failed' | 'succeeded' | 'no_findings';
  findingsCount: number | null;
  costUsd: number | null;
  githubUrl: string | null;
  source: 'ci';
  verdict: string | null;
  critical: number | null;
  warning: number | null;
  suggestion: number | null;
  durationMs: number | null;
  model: string | null;
  agentVersion: number | null;
  runnerVersion: string | null;
  workflowVersion: number | null;
  reason: string | null;
}

const cap = (s: string | null | undefined, n: number): string | null => (s == null ? null : s.slice(0, n));

function base(run: ActionsRun, inst: IngestInstallation) {
  return {
    ciInstallationId: inst.id,
    workspaceId: inst.workspaceId,
    agentId: inst.agentId,
    agentName: inst.agentName,
    githubRunId: run.id,
    repo: inst.repo,
    prTitle: cap(run.display_title, 500),
    commitSha: run.head_sha,
    ranAt: run.ran_at ? new Date(run.ran_at) : null,
    githubUrl: run.html_url,
    source: 'ci' as const,
    workflowVersion: inst.workflowVersion,
  };
}

/** A run with no usable result: failed, with a reason and none of the artifact's counts (AC-62, AC-63). */
export function failedRunRow(run: ActionsRun, inst: IngestInstallation, reason: string): CiRunValues {
  return {
    ...base(run, inst),
    prNumber: run.pull_requests[0] ?? null,
    status: 'failed',
    findingsCount: null,
    costUsd: null,
    verdict: null,
    critical: null,
    warning: null,
    suggestion: null,
    durationMs: null,
    model: null,
    agentVersion: null,
    runnerVersion: null,
    reason,
  };
}

export function validRunRow(run: ActionsRun, inst: IngestInstallation, a: CiResultArtifact): CiRunValues {
  return {
    ...base(run, inst),
    prNumber: a.pr_number ?? run.pull_requests[0] ?? null,
    status: statusFor(a),
    findingsCount: a.findings_count,
    costUsd: a.cost_usd,
    verdict: a.verdict ?? null,
    critical: a.critical ?? null,
    warning: a.warning ?? null,
    suggestion: a.suggestion ?? null,
    durationMs: a.duration_ms ?? null,
    model: cap(a.model, 200),
    agentVersion: a.agent_version ?? null,
    runnerVersion: cap(a.version, 50),
    reason: null,
  };
}

/** The `agent_runs` row for a valid CI run (AC-64). */
export interface AgentRunValues {
  workspaceId: string;
  agentId: string;
  prId: string | null;
  ranAt: Date;
  provider: 'openrouter';
  model: string | null;
  durationMs: number | null;
  status: 'done';
  source: 'ci';
  findingsCount: number;
  blockers: number | null;
  severityCounts: { critical: number; warning: number; suggestion: number };
  costUsd: number | null;
}

export function agentRunValues(row: CiRunValues, a: CiResultArtifact, prId: string | null): AgentRunValues {
  return {
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    prId,
    ranAt: row.ranAt ?? new Date(),
    provider: 'openrouter',
    model: row.model,
    durationMs: row.durationMs,
    status: 'done',
    source: 'ci',
    findingsCount: a.findings_count,
    blockers: a.blockers ?? null,
    severityCounts: { critical: a.critical ?? 0, warning: a.warning ?? 0, suggestion: a.suggestion ?? 0 },
    costUsd: a.cost_usd,
  };
}
