import type { Severity } from '@devdigest/shared';

/** Max distance (in lines) between two findings for them to be grouped. */
export const LINE_GAP = 3;
/** Min title-word Jaccard similarity to group findings of different categories. */
export const JACCARD_MIN = 0.5;
/** Title words shorter than this are ignored by the similarity measure. */
export const MIN_WORD_LEN = 3;
/** How many of an agent's latest done runs feed its duration/cost estimate. */
export const ESTIMATE_SAMPLE = 10;
/** Column name for a run whose agent row no longer exists. */
export const DELETED_AGENT_NAME = 'Deleted agent';

/** Higher = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 3,
  WARNING: 2,
  SUGGESTION: 1,
};
