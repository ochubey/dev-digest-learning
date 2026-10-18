/** An accept rate over fewer decisions than this is marked "low sample". */
export const LOW_SAMPLE_MIN = 5;
/** Longest period a request may cover. */
export const MAX_RANGE_DAYS = 366;
/** Period used when `from` and `to` are both omitted: the 30 days ending now. */
export const DEFAULT_DAYS = 30;
/** Group key for runs whose `model` is null or blank. */
export const UNKNOWN_MODEL = 'unknown';
/** Every cost produced here is a DevDigest estimate; there is no billing data. */
export const COST_BASIS = 'estimate' as const;
export const DAY_MS = 86_400_000;
