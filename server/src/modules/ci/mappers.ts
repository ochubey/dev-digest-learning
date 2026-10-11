import type { CiInstallation, CiRun } from '@devdigest/shared';
import type { InstallationRow, RunRow } from './repository.js';

export function toCiInstallation(
  row: InstallationRow,
  extra: { configChanged?: boolean; lastRun?: RunRow | null } = {},
): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
    repo_id: row.repoId,
    github_repo_id: row.githubRepoId,
    slug: row.slug,
    workflow_version: row.workflowVersion,
    agent_version: row.agentVersion,
    ci_fail_on: row.ciFailOn,
    post_as: row.postAs,
    triggers: row.triggers ?? [],
    files: row.files ?? [],
    pr_url: row.prUrl,
    updated_at: row.updatedAt?.toISOString() ?? null,
    config_changed: extra.configChanged ?? null,
    last_run: extra.lastRun
      ? { status: extra.lastRun.status, ran_at: extra.lastRun.ranAt?.toISOString() ?? null }
      : null,
  };
}

export function toCiRun(row: RunRow): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    pr_number: row.prNumber,
    ran_at: row.ranAt?.toISOString() ?? null,
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    agent: row.agentName,
    duration_s: row.durationMs == null ? null : row.durationMs / 1000,
    github_run_id: row.githubRunId,
    repo: row.repo,
    pr_title: row.prTitle,
    commit_sha: row.commitSha,
    verdict: row.verdict,
    critical: row.critical,
    warning: row.warning,
    suggestion: row.suggestion,
    duration_ms: row.durationMs,
    model: row.model,
    agent_version: row.agentVersion,
    runner_version: row.runnerVersion,
    workflow_version: row.workflowVersion,
    reason: row.reason,
    agent_id: row.agentId,
    agent_run_id: row.agentRunId,
  };
}
