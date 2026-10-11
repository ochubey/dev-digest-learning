export {
  EVAL_MAX_CASES_PER_RUN,
  EVAL_RUN_CONCURRENCY,
  EVAL_CASE_TIMEOUT_MS,
  EVAL_FRAGMENT_MAX_BYTES,
  EVAL_CASE_NAME_MAX,
} from '@devdigest/shared';

/** Fixed task line for every eval case: names no PR, repository or author (AC-34). */
export const EVAL_TASK_LINE = 'Review the following change.';

/** Free-text and path caps for a stored case (LOW-2). */
export const EVAL_NOTES_MAX = 2000;
export const EVAL_FILE_MAX = 500;
/** Cases one agent may own (same figure as a run's ceiling, so every case can run). */
export const EVAL_MAX_CASES_PER_AGENT = 50;
/** Eval runs one workspace may have running at once (MEDIUM-1). */
export const EVAL_MAX_RUNNING_PER_WORKSPACE = 3;

/** Longest stored/logged failure reason, in characters. */
export const REASON_MAX = 300;

export const EVAL_RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
