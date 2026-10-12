import { describe, it, expect } from "vitest";
import {
  EvalSuiteRunDetail,
  EvalOverview,
  EvalCompare,
  EvalCaseView,
  EVAL_MAX_CASES_PER_RUN,
  EVAL_RUN_CONCURRENCY,
  EVAL_CASE_TIMEOUT_MS,
  EVAL_FRAGMENT_MAX_BYTES,
  EVAL_CASE_NAME_MAX,
} from "@devdigest/shared";
import * as mirror from "../components/evals/constants";

const expectation = { kind: "must_not_flag", file: "src/a.ts", start_line: 1, end_line: 2 };
const run = {
  id: "r1", agent_id: "a1", agent_version: 1, status: "completed_with_errors", error: null,
  cases_total: 1, cases_done: 1,
  metrics: { recall: null, precision: 0.5, citation_accuracy: null },
  counts: null, duration_ms: null, cost_usd: null,
  started_at: "2026-10-11T10:00:00Z", finished_at: null,
};
const detail = {
  ...run,
  manifest: {
    provider: "anthropic", model: "m", system_prompt: "p", strategy: "single-pass",
    ci_fail_on: "never", repo_intel: true, skills: [], skill_versions: [],
  },
  results: [
    {
      id: "x1", case_id: "c1", case_name: "n", expectation, origin: "dismissed_finding",
      status: "error", pass: null, grounded: [], dropped: [],
      duration_ms: null, tokens_in: null, tokens_out: null, cost_usd: null, error: "boom",
    },
  ],
};

describe("client copy of eval contracts", () => {
  it("client copy parses fixtures; mirrored constants equal vendored", () => {
    expect(EvalSuiteRunDetail.parse(detail).results).toHaveLength(1);
    expect(EvalCompare.parse({ a: detail, b: detail }).a.id).toBe("r1");
    expect(
      EvalOverview.parse({
        agents: [{ agent_id: "a1", name: "A", model: "m", version: 1, latest: run, previous: null }],
        recent: [run],
      }).recent,
    ).toHaveLength(1);
    expect(
      EvalCaseView.parse({
        id: "c1", agent_id: "a1", name: "n", expectation, input_diff: "", notes: null,
        origin: "seeded", source_finding_id: null, source_pr_id: null, last_result: null,
      }).last_result,
    ).toBeNull();

    expect(mirror.EVAL_MAX_CASES_PER_RUN).toBe(EVAL_MAX_CASES_PER_RUN);
    expect(mirror.EVAL_RUN_CONCURRENCY).toBe(EVAL_RUN_CONCURRENCY);
    expect(mirror.EVAL_CASE_TIMEOUT_MS).toBe(EVAL_CASE_TIMEOUT_MS);
    expect(mirror.EVAL_FRAGMENT_MAX_BYTES).toBe(EVAL_FRAGMENT_MAX_BYTES);
    expect(mirror.EVAL_CASE_NAME_MAX).toBe(EVAL_CASE_NAME_MAX);
  });
});
