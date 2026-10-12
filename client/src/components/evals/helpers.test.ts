import { describe, it, expect } from "vitest";
import type { EvalCaseView, EvalSuiteRun, EvalSuiteRunDetail, EvalCaseResult, EvalRunManifest } from "@devdigest/shared";
import {
  formatPct,
  deltaPt,
  nullReason,
  sortCases,
  latestFinished,
  previousFinished,
  versionDrift,
  orderPair,
  caseChanges,
  manifestDiff,
  diffWords,
} from "./helpers";
import messages from "../../../messages/en/evals.json";

function run(over: Partial<EvalSuiteRun> & { id: string }): EvalSuiteRun {
  return {
    agent_id: "a1",
    agent_version: 1,
    status: "completed",
    error: null,
    cases_total: 8,
    cases_done: 8,
    metrics: { recall: null, precision: null, citation_accuracy: null },
    counts: null,
    duration_ms: null,
    cost_usd: null,
    started_at: "2026-10-11T10:00:00Z",
    finished_at: "2026-10-11T10:01:00Z",
    ...over,
  };
}

const MANIFEST: EvalRunManifest = {
  provider: "anthropic",
  model: "m1",
  system_prompt: "Review the code. Be strict.",
  strategy: "single-pass",
  ci_fail_on: "never",
  repo_intel: true,
  skills: [],
  skill_versions: [],
};

function result(over: Partial<EvalCaseResult> & { case_name: string }): EvalCaseResult {
  return {
    id: `x-${over.case_name}`,
    case_id: `c-${over.case_name}`,
    expectation: { kind: "must_find", file: "a.ts", start_line: 1, end_line: 2 },
    origin: "seeded",
    status: "ok",
    pass: true,
    grounded: [],
    dropped: [],
    duration_ms: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    error: null,
    ...over,
  };
}

function detail(id: string, results: EvalCaseResult[], manifest = MANIFEST, started = "2026-10-11T10:00:00Z"): EvalSuiteRunDetail {
  return { ...run({ id, started_at: started }), manifest, results };
}

describe("formatPct / deltaPt", () => {
  it("0.75 -> 0.88 = ▲ 13pt, decrease ▼", () => {
    expect(formatPct(0.88)).toBe("88%");
    expect(formatPct(null)).toBe("—");
    expect(deltaPt(0.88, 0.75)).toBe("▲ 13pt");
    expect(deltaPt(0.5, 0.75)).toBe("▼ 25pt");
    expect(deltaPt(0.75, 0.75)).toBe("0pt");
  });

  it("has no delta when either side is null", () => {
    expect(deltaPt(null, 0.5)).toBeNull();
    expect(deltaPt(0.5, null)).toBeNull();
  });
});

describe("nullReason", () => {
  it("returns a key whose text is the spec reason", () => {
    const text = (k: string) => (messages.metric.nullReason as Record<string, string>)[k];
    expect(text(nullReason("recall"))).toBe("no must-find cases");
    expect(text(nullReason("precision"))).toBe("no findings returned");
    expect(text(nullReason("citation_accuracy"))).toBe("no findings produced");
  });
});

describe("sortCases", () => {
  it("orders by kind (must_find first) then name, without mutating", () => {
    const mk = (name: string, kind: "must_find" | "must_not_flag") =>
      ({ name, expectation: { kind, file: "a", start_line: 1, end_line: 1 } }) as EvalCaseView;
    const input = [mk("b", "must_not_flag"), mk("z", "must_find"), mk("a", "must_not_flag"), mk("c", "must_find")];
    expect(sortCases(input).map((c) => c.name)).toEqual(["c", "z", "a", "b"]);
    expect(input[0]!.name).toBe("b");
  });
});

describe("latestFinished / previousFinished / versionDrift", () => {
  const runs = [
    run({ id: "r3", status: "running", started_at: "2026-10-11T12:00:00Z" }),
    run({ id: "r2", status: "completed_with_errors", started_at: "2026-10-11T11:00:00Z", agent_version: 3 }),
    run({ id: "r1", status: "completed", started_at: "2026-10-11T10:00:00Z" }),
    run({ id: "r0", status: "failed", started_at: "2026-10-11T09:00:00Z" }),
  ];
  it("skips running and failed runs", () => {
    expect(latestFinished(runs)?.id).toBe("r2");
    expect(previousFinished(runs)?.id).toBe("r1");
    expect(latestFinished([])).toBeNull();
    expect(previousFinished([runs[1]!])).toBeNull();
  });
  it("reports drift only when the run is older than the agent", () => {
    expect(versionDrift(runs[1]!, 4)).toEqual({ from: 3, to: 4 });
    expect(versionDrift(runs[1]!, 3)).toBeNull();
    expect(versionDrift(null, 3)).toBeNull();
  });
});

describe("orderPair", () => {
  it("puts the older run first", () => {
    const older = run({ id: "o", started_at: "2026-10-11T10:00:00Z" });
    const newer = run({ id: "n", started_at: "2026-10-11T11:00:00Z" });
    expect(orderPair(newer, older).map((r) => r.id)).toEqual(["o", "n"]);
    expect(orderPair(older, newer).map((r) => r.id)).toEqual(["o", "n"]);
  });
});

describe("caseChanges", () => {
  it("8 cases: 1 regressed, 2 fixed, 1 errored; onlyA/onlyB", () => {
    const a = detail("a", [
      result({ case_name: "reg", pass: true }),
      result({ case_name: "fix1", pass: false }),
      result({ case_name: "fix2", pass: false }),
      result({ case_name: "err", pass: true }),
      result({ case_name: "same1", pass: true }),
      result({ case_name: "same2", pass: false }),
      result({ case_name: "gone", pass: true }),
    ]);
    const b = detail("b", [
      result({ case_name: "reg", pass: false }),
      result({ case_name: "fix1", pass: true }),
      result({ case_name: "fix2", pass: true }),
      result({ case_name: "err", status: "error", pass: null, error: "boom" }),
      result({ case_name: "same1", pass: true }),
      result({ case_name: "same2", pass: false }),
      result({ case_name: "new", pass: true }),
    ]);
    const c = caseChanges(a, b);
    expect(c.regressed.map((x) => x.name)).toEqual(["reg"]);
    expect(c.fixed.map((x) => x.name).sort()).toEqual(["fix1", "fix2"]);
    expect(c.errored.map((x) => x.name)).toEqual(["err"]);
    expect(c.unchanged).toBe(2);
    expect(c.onlyA.map((r) => r.case_name)).toEqual(["gone"]);
    expect(c.onlyB.map((r) => r.case_name)).toEqual(["new"]);
  });

  it("keys by case_id, falling back to the snapshot name when the case was deleted", () => {
    const a = detail("a", [result({ case_name: "renamed", case_id: "c1", pass: true }), result({ case_name: "del", case_id: null, pass: true })]);
    const b = detail("b", [result({ case_name: "renamed v2", case_id: "c1", pass: false }), result({ case_name: "del", case_id: null, pass: false })]);
    const c = caseChanges(a, b);
    expect(c.regressed).toHaveLength(2);
    expect(c.onlyA).toHaveLength(0);
    expect(c.onlyB).toHaveLength(0);
  });
});

describe("manifestDiff", () => {
  it("lists model/strategy changes, skills added/removed and version changes", () => {
    const a: EvalRunManifest = {
      ...MANIFEST,
      skills: ["s1", "s2"],
      skill_versions: [
        { id: "s1", name: "no-any", version: 1 },
        { id: "s2", name: "sql", version: 2 },
      ],
    };
    const b: EvalRunManifest = {
      ...MANIFEST,
      model: "m2",
      strategy: "map-reduce",
      skills: ["s1", "s3"],
      skill_versions: [
        { id: "s1", name: "no-any", version: 4 },
        { id: "s3", name: "tests", version: 1 },
      ],
    };
    const d = manifestDiff(a, b);
    expect(d.fields).toEqual([
      { key: "model", from: "m1", to: "m2" },
      { key: "strategy", from: "single-pass", to: "map-reduce" },
    ]);
    expect(d.skillsAdded).toEqual(["tests"]);
    expect(d.skillsRemoved).toEqual(["sql"]);
    expect(d.skillVersionChanges).toEqual([{ name: "no-any", from: 1, to: 4 }]);
    expect(d.promptChanged).toBe(false);
  });

  it("is empty for equal manifests", () => {
    const d = manifestDiff(MANIFEST, { ...MANIFEST });
    expect(d.fields).toEqual([]);
    expect(d.skillsAdded).toEqual([]);
    expect(d.promptChanged).toBe(false);
  });
});

describe("diffWords", () => {
  it("marks one changed sentence", () => {
    const out = diffWords("Review the code. Be strict.", "Review the code. Be lenient.");
    expect(out.filter((t) => t.k === "del").map((t) => t.t)).toEqual(["strict."]);
    expect(out.filter((t) => t.k === "add").map((t) => t.t)).toEqual(["lenient."]);
    expect(out.filter((t) => t.k === "same").map((t) => t.t).join("")).toBe("Review the code. Be ");
  });
});
