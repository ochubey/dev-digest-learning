/** Merged PRs scanned (one GitHub `listFiles` call each) when looking for prior PRs. */
export const HISTORY_SCAN_LIMIT = 30;

/** Prior PRs returned. */
export const HISTORY_LIMIT = 10;

/** Cache the GitHub result per PR + head sha: avoids re-scanning on every page load. */
export const HISTORY_CACHE_TTL_MS = 5 * 60_000;
export const HISTORY_CACHE_MAX = 200;
