import { describe, it, expect } from "vitest";
import type { DownstreamImpact } from "@devdigest/shared";
import { layoutGraph, truncate } from "./graph";
import { GRAPH } from "./constants";

const impact = (over: Partial<DownstreamImpact> & { symbol: string }): DownstreamImpact => ({
  callers: [],
  endpoints_affected: [],
  crons_affected: [],
  ...over,
});

describe("layoutGraph", () => {
  it("returns null when there is nothing downstream", () => {
    expect(layoutGraph([])).toBeNull();
    expect(layoutGraph([impact({ symbol: "foo" })])).toBeNull();
  });

  it("builds symbol -> caller -> endpoint/cron columns and edges", () => {
    const g = layoutGraph([
      impact({
        symbol: "foo",
        callers: [{ name: "h", file: "r.ts", line: 1 }],
        endpoints_affected: ["GET /a"],
        crons_affected: ["nightly"],
      }),
    ])!;
    const kinds = g.nodes.map((n) => n.kind).sort();
    expect(kinds).toEqual(["caller", "cron", "endpoint", "symbol"]);
    const col = (k: string) => g.nodes.find((n) => n.kind === k)!.x;
    expect(col("symbol")).toBeLessThan(col("caller"));
    expect(col("caller")).toBeLessThan(col("endpoint"));
    expect(col("endpoint")).toBe(col("cron"));
    expect(g.edges).toHaveLength(3); // symbol->caller, caller->endpoint, caller->cron
  });

  it("shares a caller across symbols and dedupes endpoints", () => {
    const g = layoutGraph([
      impact({
        symbol: "a",
        callers: [{ name: "h", file: "r.ts", line: 1 }],
        endpoints_affected: ["GET /x"],
      }),
      impact({
        symbol: "b",
        callers: [{ name: "h", file: "r.ts", line: 9 }],
        endpoints_affected: ["GET /x"],
      }),
    ])!;
    expect(g.nodes.filter((n) => n.kind === "caller")).toHaveLength(1);
    expect(g.nodes.filter((n) => n.kind === "endpoint")).toHaveLength(1);
    // a->h, b->h, and h->x once (the same edge from both groups is deduped)
    expect(g.edges).toHaveLength(3);
  });

  it("links a symbol straight to endpoints when it has no callers", () => {
    const g = layoutGraph([impact({ symbol: "foo", endpoints_affected: ["GET /a"] })])!;
    expect(g.edges).toEqual([{ from: "s:foo", to: "e:GET /a" }]);
  });

  it("keeps every node inside the viewBox", () => {
    const g = layoutGraph([
      impact({
        symbol: "foo",
        callers: Array.from({ length: 5 }, (_, i) => ({ name: `c${i}`, file: "r.ts", line: i })),
        endpoints_affected: ["GET /a"],
      }),
    ])!;
    for (const n of g.nodes) {
      expect(n.x + GRAPH.nodeW).toBeLessThanOrEqual(g.width);
      expect(n.y + GRAPH.nodeH).toBeLessThanOrEqual(g.height);
      expect(n.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("truncate", () => {
  it("keeps short labels and ellipsizes long ones to the limit", () => {
    expect(truncate("short")).toBe("short");
    const out = truncate("x".repeat(60));
    expect(out).toHaveLength(GRAPH.maxChars);
    expect(out.endsWith("…")).toBe(true);
  });
});
