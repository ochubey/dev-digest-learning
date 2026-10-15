/**
 * Run-log text for the ci module. Ids, counts, codes and rule names only: these builders take
 * no artifact contents, token, key or file body (Observability NFR, AC-62).
 */

const val = (v: string | number | null | undefined): string => (v == null ? 'null' : String(v));

export function exportLine(a: {
  agentId: string;
  repo: string;
  mode: 'open_pr' | 'files';
  outcome: 'ok' | 'error';
  code?: string | null;
}): string {
  return `ci.export agent=${a.agentId} repo=${a.repo} mode=${a.mode} outcome=${a.outcome} code=${val(a.code)}`;
}

export function syncLine(a: {
  repo: string;
  installationId: string;
  seen: number;
  ingested: number;
  rejected: number;
  rules: string[];
  code?: string | null;
}): string {
  return (
    `ci.sync repo=${a.repo} installation=${a.installationId} seen=${a.seen} ingested=${a.ingested} ` +
    `rejected=${a.rejected} rules=${a.rules.join(',') || 'none'} code=${val(a.code)}`
  );
}

export function rejectLine(a: { installationId: string; runId: number; rule: string }): string {
  return `ci.sync reject installation=${a.installationId} run=${a.runId} rule=${a.rule}`;
}
