/** Shared constants for the agent-performance feature (SPEC-06). */

export const DAY_MS = 86_400_000;
/** Longest custom range the server accepts (D-8). */
export const MAX_RANGE_DAYS = 366;
/** Fewer decisions than this make the accept rate a weak signal (D-13). */
export const LOW_SAMPLE_MIN = 5;
export const PRESET_DAYS = { "1d": 1, "30d": 30 } as const;
export const DEFAULT_RANGE = "30d" as const;
export const EM_DASH = "—";
