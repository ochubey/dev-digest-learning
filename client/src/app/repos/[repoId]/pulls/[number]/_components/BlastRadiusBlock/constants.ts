/** How long to wait for a resync to write a new index row before giving up on auto-refresh. */
export const RESYNC_POLL_MAX_MS = 120_000;

/** Degraded reasons where a resync can help (flag_off / repo_too_large cannot be fixed by one). */
export const RESYNCABLE_REASONS = ["no_data", "index_failed", "index_partial", "unknown"] as const;
