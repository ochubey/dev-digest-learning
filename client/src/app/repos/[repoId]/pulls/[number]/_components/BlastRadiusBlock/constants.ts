/** How long to wait for a resync to write a new index row before giving up on auto-refresh. */
export const RESYNC_POLL_MAX_MS = 120_000;

/** Degraded reasons where a resync can help (flag_off / repo_too_large cannot be fixed by one). */
export const RESYNCABLE_REASONS = ["no_data", "index_failed", "index_partial", "unknown"] as const;

/** Graph geometry (SVG user units; the SVG scales to the card width via viewBox). */
export const GRAPH = {
  nodeW: 190,
  nodeH: 28,
  rowGap: 10,
  colGap: 90,
  pad: 8,
  /** Labels longer than this are truncated; the full text stays in the node's <title>. */
  maxChars: 24,
  /** Symbols drawn (already ordered by importance); the tree has the full list. */
  maxSymbols: 8,
} as const;

/** Shared files listed per prior PR before collapsing the rest into "+N more". */
export const HISTORY_FILES_SHOWN = 3;

/** Symbols with downstream impact listed before "Show all"; the rest stay one click away. */
export const SYMBOLS_INITIAL = 10;
