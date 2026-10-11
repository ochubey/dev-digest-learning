import { describe, it, expect } from "vitest";
import { mkRun } from "@/app/evals/fixtures";
import { filterByRange, recentSeries, regression } from "./helpers";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const m = (recall: number | null, precision: number | null, citation_accuracy: number | null) => ({ recall, precision, citation_accuracy });

describe("filterByRange", () => {
  const runs = [mkRun({ id: "a", started_at: at(1) }), mkRun({ id: "b", started_at: at(10) }), mkRun({ id: "c", started_at: at(60) }), mkRun({ id: "d", started_at: at(400) })];
  it.each([
    ["7d", ["a"]],
    ["30d", ["a", "b"]],
    ["90d", ["a", "b", "c"]],
    ["all", ["a", "b", "c", "d"]],
  ] as const)("%s", (range, ids) => {
    expect(filterByRange(runs, range, NOW).map((r) => r.id)).toEqual(ids);
  });
});

describe("recentSeries", () => {
  it("is finished-only, oldest first, last 8", () => {
    const runs = Array.from({ length: 10 }, (_, i) => mkRun({ id: `r${i}`, started_at: at(10 - i), metrics: m(i / 10, 0.5, 1) }));
    runs.push(mkRun({ id: "f", status: "failed", started_at: at(0), metrics: m(null, null, null) }));
    const s = recentSeries(runs, "recall");
    expect(s).toHaveLength(8);
    expect(s[0]).toBe(0.2);
    expect(s[7]).toBe(0.9);
  });
  it("passed is cases_passed / cases_scored", () => {
    expect(recentSeries([mkRun()], "passed")).toEqual([0.75]);
  });
});

describe("regression", () => {
  it("lists dropped and the other metrics", () => {
    const r = regression([
      mkRun({ id: "n", agent_version: 4, started_at: at(1), metrics: m(0.9, 0.4, 1) }),
      mkRun({ id: "p", agent_version: 3, started_at: at(2), metrics: m(0.5, 0.5, 1) }),
    ]);
    expect(r).toEqual({ version: 4, dropped: [{ key: "precision", pt: 10 }], others: [{ key: "recall", kind: "up", pt: 40 }, { key: "citation_accuracy", kind: "flat", pt: 0 }] });
  });
  it("null when nothing dropped, null metrics, or fewer than two finished runs", () => {
    expect(regression([mkRun({ id: "n", started_at: at(1) }), mkRun({ id: "p", started_at: at(2) })])).toBeNull();
    expect(regression([mkRun()])).toBeNull();
    expect(regression([mkRun({ id: "n", started_at: at(1), metrics: m(null, null, null) }), mkRun({ id: "p", started_at: at(2) })])).toBeNull();
    expect(regression([mkRun({ id: "n", started_at: at(1), metrics: m(0, 0, 0) }), mkRun({ id: "x", status: "failed", started_at: at(2) })])).toBeNull();
  });
});
