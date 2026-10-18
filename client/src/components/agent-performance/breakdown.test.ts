import { describe, it, expect } from "vitest";
import { buildBreakdown } from "./breakdown";

describe("buildBreakdown", () => {
  it("computes shares from unrounded values, largest first, ties by label", () => {
    const items = buildBreakdown(
      [
        { key: "b", label: "B", cost_usd: 0.0001 },
        { key: "a", label: "A", cost_usd: 0.0001 },
        { key: "c", label: "C", cost_usd: 0.0002 },
      ],
      0.0004,
    );
    expect(items.map((i) => i.label)).toEqual(["C", "A", "B"]);
    expect(items.map((i) => i.share)).toEqual([0.5, 0.25, 0.25]);
  });
  it("uses the server total, so shares need not add up to the rounded sum", () => {
    const third = 1 / 3;
    const items = buildBreakdown(
      [1, 2, 3].map((n) => ({ key: String(n), label: `m${n}`, cost_usd: third })),
      1,
    );
    expect(items.every((i) => i.share === third)).toBe(true);
  });
  it("returns nothing when there is no total", () => {
    expect(buildBreakdown([{ key: "a", label: "A", cost_usd: 1 }], null)).toEqual([]);
    expect(buildBreakdown([], null)).toEqual([]);
  });
  it("a real total of 0 lists the entries with a 0 share (AC-57)", () => {
    const items = buildBreakdown(
      [
        { key: "b", label: "B", cost_usd: 0 },
        { key: "a", label: "A", cost_usd: 0 },
      ],
      0,
    );
    expect(items.map((i) => [i.label, i.share])).toEqual([["A", 0], ["B", 0]]);
    expect(buildBreakdown([], 0)).toEqual([]);
  });
});
