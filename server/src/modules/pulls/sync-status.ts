/** Outcome of the last GitHub PR sync of a repo, surfaced as a banner in the PR list. */
export type SyncReason = 'no_token' | 'bad_credentials' | 'no_access' | 'rate_limited' | 'error';

export interface SyncStatus {
  ok: boolean;
  reason?: SyncReason;
  /** HTTP status GitHub answered with, when there was one. */
  status?: number;
  message?: string;
  at: string;
}

/** Map a GitHub/Octokit error (or a missing-token ConfigError) to a stable reason code. */
export function classifyGithubError(err: unknown): { reason: SyncReason; status?: number; message: string } {
  const e = err as { status?: number; message?: string; name?: string; response?: { headers?: Record<string, string> } };
  // Strip the docs URL Octokit appends ("Bad credentials - https://docs.github.com/rest").
  const message = (e?.message ?? String(err)).replace(/\s+-\s+https?:\/\/\S+/g, '').slice(0, 300);
  if (e?.name === 'ConfigError' || /GITHUB_TOKEN is not configured/i.test(message)) {
    return { reason: 'no_token', message };
  }
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (status === 401) return { reason: 'bad_credentials', status, message };
  if (status === 429 || (status === 403 && e?.response?.headers?.['x-ratelimit-remaining'] === '0')) {
    return { reason: 'rate_limited', status, message };
  }
  if (status === 403 || status === 404) return { reason: 'no_access', status, message };
  return { reason: 'error', status, message };
}

const lastSync = new Map<string, SyncStatus>();

export const recordSync = (repoId: string, result: Omit<SyncStatus, 'at'>): void => {
  lastSync.set(repoId, { ...result, at: new Date().toISOString() });
};

/** Never attempted (e.g. fresh process) counts as ok: nothing is known to be wrong. */
export const getSync = (repoId: string): SyncStatus =>
  lastSync.get(repoId) ?? { ok: true, at: new Date(0).toISOString() };
