/** Test ids shared with the e2e specs (SPEC-03 P9). */
export const EVAL_TEST_IDS = {
  agentRow: "eval-agent-row",
  runRow: "eval-run-row",
  runSelect: "eval-run-select",
  compareButton: "eval-compare-button",
  compareDialog: "eval-compare-dialog",
  compareDelta: "eval-compare-delta",
  promptIns: "eval-prompt-ins",
  promptDel: "eval-prompt-del",
} as const;

/** AC-66: Compare works on exactly two runs. */
export const COMPARE_SELECTION_SIZE = 2;

/** Rows shown on the landing (AC-60). */
export const RECENT_RUNS_LIMIT = 6;
