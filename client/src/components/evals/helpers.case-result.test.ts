import { describe, it, expect } from "vitest";
import type { EvalCaseView } from "@devdigest/shared";
import { caseResultDetail, caseResultLabel } from "./helpers";

type K = "must_find" | "must_not_flag";
function mk(kind: K, last: EvalCaseView["last_result"]): EvalCaseView {
  return {
    id: "c1",
    agent_id: "a1",
    name: "case",
    expectation: { kind, file: "a.ts", start_line: 1, end_line: 2 },
    input_diff: "",
    notes: null,
    origin: "seeded",
    source_finding_id: null,
    source_pr_id: null,
    last_result: last,
  };
}
const last = (status: "pass" | "fail" | "error", matched: number, kind: K, error: string | null = null) => ({
  run_id: "r1",
  status,
  matched,
  kind,
  error,
});

describe("caseResultLabel", () => {
  it("maps last_result status, never run when null", () => {
    expect(caseResultLabel(mk("must_find", null))).toBe("never");
    expect(caseResultLabel(mk("must_find", last("pass", 1, "must_find")))).toBe("pass");
    expect(caseResultLabel(mk("must_find", last("fail", 0, "must_find")))).toBe("fail");
    expect(caseResultLabel(mk("must_find", last("error", 0, "must_find", "boom")))).toBe("error");
  });
});

describe("caseResultDetail", () => {
  it("null when never run", () => {
    expect(caseResultDetail(mk("must_find", null))).toBeNull();
  });
  it("must-find miss and hit", () => {
    expect(caseResultDetail(mk("must_find", last("fail", 0, "must_find")))).toEqual({ key: "mustFindMiss", count: 0, error: null });
    expect(caseResultDetail(mk("must_find", last("pass", 2, "must_find")))).toEqual({ key: "mustFindHit", count: 2, error: null });
  });
  it("must-not-flag clean and violated", () => {
    expect(caseResultDetail(mk("must_not_flag", last("pass", 0, "must_not_flag")))?.key).toBe("mustNotFlagClean");
    expect(caseResultDetail(mk("must_not_flag", last("fail", 1, "must_not_flag")))?.key).toBe("mustNotFlagHit");
  });
  it("error carries the runner text, or a fallback key", () => {
    expect(caseResultDetail(mk("must_find", last("error", 0, "must_find", "timeout")))).toEqual({ key: "error", count: 0, error: "timeout" });
    expect(caseResultDetail(mk("must_find", last("error", 0, "must_find")))?.key).toBe("errorUnknown");
  });
});
