export {
  EVAL_MAX_CASES_PER_RUN,
  EVAL_RUN_CONCURRENCY,
  EVAL_CASE_TIMEOUT_MS,
  EVAL_FRAGMENT_MAX_BYTES,
  EVAL_CASE_NAME_MAX,
} from '@devdigest/shared';

/** Fixed task line for every eval case: names no PR, repository or author (AC-34). */
export const EVAL_TASK_LINE = 'Review the following change.';

export const EVAL_RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
