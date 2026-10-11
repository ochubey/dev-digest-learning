import { describe, it, expect } from "vitest";
import { mkRun } from "@/app/evals/fixtures";
import { recallTrend } from "./helpers";

const run = (i: number, over = {}) =>
  mkRun({
    id: `r${i}`,
    started_at: `2026-10-${String(i).padStart(2, "0")}T10:00:00Z`,
    metrics: { recall: i / 100, precision: 0.5, citation_accuracy: 1 },
    ...over,
  });

describe("recallTrend", () => {
  it("returns recall values oldest first", () => {
    expect(recallTrend([run(3), run(1), run(2)])).toEqual([0.01, 0.02, 0.03]);
  });
  it("keeps only the last 8 finished runs and skips running/failed", () => {
    const runs = [...Array.from({ length: 10 }, (_, i) => run(i + 1)), run(11, { status: "running" }), run(12, { status: "failed" })];
    expect(recallTrend(runs)).toEqual([0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1]);
  });
  it("keeps null recall as null and handles no runs", () => {
    expect(recallTrend([run(1, { metrics: { recall: null, precision: null, citation_accuracy: null } }), run(2)])).toEqual([null, 0.02]);
    expect(recallTrend([])).toEqual([]);
  });
});
