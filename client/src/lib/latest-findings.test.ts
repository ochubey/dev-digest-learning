import { describe, it, expect } from "vitest";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import {
  latestFindingsPerAgent,
  filesWithFindings,
  hiddenByScope,
  isVisibleScope,
  isInScope,
} from "./latest-findings";

describe("scope predicates", () => {
  it.each([
    ["in", true, true],
    ["out", false, false],
    ["signal", true, false],
    [null, true, true],
    [undefined, true, true],
  ] as const)("scope=%s -> visible=%s inScope=%s", (scope, visible, inScope) => {
    expect(isVisibleScope(scope)).toBe(visible);
    expect(isInScope(scope)).toBe(inScope);
  });
});

const fi = (
  id: string,
  line: number,
  over: Partial<FindingRecord> = {},
  file = "a.ts",
): FindingRecord => ({
  id,
  severity: "WARNING",
  category: "bug",
  title: `t-${id}`,
  file,
  start_line: line,
  end_line: line,
  rationale: "r",
  confidence: 0.9,
  review_id: "r",
  accepted_at: null,
  dismissed_at: null,
  ...over,
});

const rv = (
  id: string,
  agentId: string | null,
  kind: "review" | "summary",
  createdAt: number,
  findings: FindingRecord[],
): ReviewRecord => ({
  id,
  pr_id: "pr1",
  agent_id: agentId,
  run_id: null,
  kind,
  verdict: null,
  summary: null,
  score: null,
  model: null,
  created_at: new Date(createdAt).toISOString(),
  findings,
});

describe("latestFindingsPerAgent", () => {
  it("rule: accepted stays (muted) and counts, dismissed is dropped and does not count", () => {
    const reviews = [
      rv("r1", "A", "review", 1000, [
        fi("acc", 1, { accepted_at: "2026-01-01T00:00:00Z" }, "acc.ts"),
        fi("dis", 1, { dismissed_at: "2026-01-01T00:00:00Z" }, "dis.ts"),
      ]),
    ];
    expect(latestFindingsPerAgent(reviews).map((x) => x.id)).toEqual(["acc"]);
    expect([...filesWithFindings(latestFindingsPerAgent(reviews))]).toEqual(["acc.ts"]);
  });

  it("is empty with no reviews", () => {
    expect(latestFindingsPerAgent([])).toEqual([]);
    expect(latestFindingsPerAgent(undefined)).toEqual([]);
  });

  it("takes only the newest review of each agent and unions them", () => {
    const out = latestFindingsPerAgent([
      rv("r1", "A", "review", 1000, [fi("f1", 1)]),
      rv("r2", "A", "review", 2000, [fi("f2", 2)]),
      rv("r3", "B", "review", 500, [fi("f3", 3)]),
    ]);
    expect(out.map((x) => x.start_line).sort()).toEqual([2, 3]);
  });

  it("is independent of input order", () => {
    const out = latestFindingsPerAgent([
      rv("r2", "A", "review", 2000, [fi("f2", 2)]),
      rv("r1", "A", "review", 1000, [fi("f1", 1)]),
    ]);
    expect(out.map((x) => x.id)).toEqual(["f2"]);
  });

  it('ignores kind "summary" reviews', () => {
    const out = latestFindingsPerAgent([
      rv("r1", "A", "review", 1000, [fi("f1", 1)]),
      rv("r2", "A", "summary", 5000, [fi("f9", 9)]),
    ]);
    expect(out.map((x) => x.id)).toEqual(["f1"]);
  });

  it("drops dismissed findings and scope === 'out'", () => {
    const out = latestFindingsPerAgent([
      rv("r1", "A", "review", 1000, [
        fi("keep", 1),
        fi("dis", 2, { dismissed_at: "2026-01-01T00:00:00Z" }),
        fi("out", 3, { scope: "out" }),
        fi("sig", 4, { scope: "signal" }),
        fi("in", 5, { scope: "in" }),
      ]),
    ]);
    expect(out.map((x) => x.id)).toEqual(["keep", "sig", "in"]);
  });

  it("keeps accepted findings (they stay visible)", () => {
    const out = latestFindingsPerAgent([
      rv("r1", "A", "review", 1000, [fi("acc", 1, { accepted_at: "2026-01-01T00:00:00Z" })]),
    ]);
    expect(out.map((x) => x.id)).toEqual(["acc"]);
  });

  it("groups reviews without an agent under one key", () => {
    const out = latestFindingsPerAgent([
      rv("r1", null, "review", 1000, [fi("f1", 1)]),
      rv("r2", null, "review", 2000, [fi("f2", 2)]),
    ]);
    expect(out.map((x) => x.id)).toEqual(["f2"]);
  });
});

/* Parity with the server rule. Mirrors the cases of server/test/smart-diff-build.test.ts
   (latestFindingsPerAgent + buildSmartDiff): the SAME inputs must give the same set of
   (file, line) pairs the server reports as `finding_lines`. Keep both in sync. */
describe("parity with server smart-diff rule", () => {
  /** What the server's buildSmartDiff would put into finding_lines, per file. */
  function serverLines(reviews: ReviewRecord[]): Record<string, number[]> {
    const out: Record<string, Set<number>> = {};
    for (const f of latestFindingsPerAgent(reviews)) {
      (out[f.file] ??= new Set()).add(f.start_line);
    }
    return Object.fromEntries(
      Object.entries(out).map(([k, v]) => [k, [...v].sort((a, b) => a - b)]),
    );
  }

  it("newest-per-agent + no dismissed + no out + no summary", () => {
    const reviews = [
      rv("r1", "A", "review", 1000, [fi("old", 1)]),
      rv("r2", "A", "review", 2000, [
        fi("n1", 7),
        fi("n2", 7), // same line twice -> deduplicated like finding_lines
        fi("n3", 3),
        fi("dis", 99, { dismissed_at: "x" }),
        fi("out", 98, { scope: "out" }),
      ]),
      rv("r3", "A", "summary", 9000, [fi("sum", 50)]),
      rv("r4", "B", "review", 500, [fi("b1", 4, {}, "b.ts")]),
    ];
    expect(serverLines(reviews)).toEqual({ "a.ts": [3, 7], "b.ts": [4] });
  });
});

describe("filesWithFindings", () => {
  it("returns the distinct set of files (3 findings in one file count once)", () => {
    const set = filesWithFindings([fi("1", 1), fi("2", 2), fi("3", 3), fi("4", 1, {}, "b.ts")]);
    expect([...set].sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("is empty for no findings", () => {
    expect(filesWithFindings([]).size).toBe(0);
  });
});

describe("hiddenByScope", () => {
  it("counts scope==='out' findings of the newest review per agent, not dismissed", () => {
    const out = hiddenByScope([
      rv("r1", "A", "review", 1000, [fi("old-out", 1, { scope: "out" })]),
      rv("r2", "A", "review", 2000, [
        fi("o1", 1, { scope: "out" }),
        fi("o2", 2, { scope: "out" }),
        fi("o-dis", 3, { scope: "out", dismissed_at: "x" }),
        fi("in", 4, { scope: "in" }),
        fi("sig", 5, { scope: "signal" }),
        fi("legacy", 6, { scope: null }),
        fi("none", 7),
      ]),
      rv("r3", "B", "review", 500, [fi("b-out", 4, { scope: "out" }, "b.ts")]),
      rv("r4", "B", "summary", 9000, [fi("sum-out", 4, { scope: "out" })]),
    ]);
    expect(out.map((x) => x.id).sort()).toEqual(["b-out", "o1", "o2"]);
  });

  it("is empty with no reviews / no out findings", () => {
    expect(hiddenByScope(undefined)).toEqual([]);
    expect(hiddenByScope([rv("r", "A", "review", 1, [fi("a", 1)])])).toEqual([]);
  });

  it("is the exact complement of latestFindingsPerAgent among non-dismissed latest findings", () => {
    const reviews = [
      rv("r1", "A", "review", 1000, [
        fi("a", 1, { scope: "out" }),
        fi("b", 2, { scope: "in" }),
        fi("c", 3, { scope: "signal" }),
        fi("d", 4, { dismissed_at: "x" }),
      ]),
    ];
    const visible = latestFindingsPerAgent(reviews).map((x) => x.id);
    const hidden = hiddenByScope(reviews).map((x) => x.id);
    expect(visible).toEqual(["b", "c"]);
    expect(hidden).toEqual(["a"]);
  });
});
