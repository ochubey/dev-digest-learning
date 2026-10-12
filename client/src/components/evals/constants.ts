/**
 * Runtime mirror of the SPEC-03 eval limits from the vendored contract
 * (`contracts/eval-ci.ts`). Pinned by `src/test/contracts-evals.test.ts`.
 */
export const EVAL_MAX_CASES_PER_RUN = 50;
export const EVAL_RUN_CONCURRENCY = 3;
export const EVAL_CASE_TIMEOUT_MS = 120_000;
export const EVAL_FRAGMENT_MAX_BYTES = 32_768;
export const EVAL_CASE_NAME_MAX = 80;
