import { describe, it, expect } from "vitest";
import { buildDiffRows, chunkDiff } from "./helpers";

const same = (text: string) => ({ k: "same" as const, text });
const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i + 1}`).join("\n");

describe("buildDiffRows", () => {
  it("collapses long unchanged stretches, keeping 2 lines of context", () => {
    const rows = buildDiffRows([same(lines(10) + "\n"), { k: "add", text: "new" }]);
    expect(rows[0]).toEqual({ kind: "gap", count: 8 });
    expect(rows).toHaveLength(4); // gap, l9, l10, new line
  });
  it("shows everything when expanded", () => {
    const rows = buildDiffRows([same(lines(10) + "\n"), { k: "add", text: "new" }], 2, true);
    expect(rows.every((r) => r.kind === "line")).toBe(true);
    expect(rows).toHaveLength(11);
  });
  it("does not collapse a single hidden line", () => {
    const rows = buildDiffRows(chunkDiff([{ k: "add", t: "x\n" }, { k: "same", t: lines(4) + "\n" }, { k: "add", t: "y" }]));
    expect(rows.some((r) => r.kind === "gap")).toBe(false);
  });
});
