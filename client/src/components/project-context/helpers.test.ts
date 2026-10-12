import { describe, it, expect } from "vitest";
import type { ContextDoc, InheritedContextDoc } from "@devdigest/shared";
import {
  formatDocTokens,
  buildRows,
  filterRows,
  footerTotals,
  serializeAs,
  serializeAsText,
  moveItem,
  reorderOnDrop,
  sourceOfPath,
} from "./helpers";

const doc = (path: string, tokens: number): ContextDoc => {
  const parts = path.split("/");
  return {
    path,
    name: parts[parts.length - 1]!,
    folder: parts.slice(0, -1).join("/"),
    source: sourceOfPath(path),
    tokens,
  };
};

const DOCS: ContextDoc[] = [
  doc("insights/z.md", 50),
  doc("docs/b.md", 1234),
  doc("specs/security-baseline.md", 400),
  doc("specs/a.md", 100),
  doc("docs/a.md", 20),
];

describe("sourceOfPath", () => {
  it("first specs/docs/insights folder segment wins; root; other", () => {
    expect(sourceOfPath("specs/a.md")).toBe("specs");
    expect(sourceOfPath("docs/sub/b.MD")).toBe("docs");
    expect(sourceOfPath("insights/c.md")).toBe("insights");
    expect(sourceOfPath("client/specs/x.md")).toBe("specs");
    expect(sourceOfPath("server/docs/specs/x.md")).toBe("docs");
    expect(sourceOfPath("README.md")).toBe("root");
    expect(sourceOfPath("docs.md")).toBe("root");
    expect(sourceOfPath("src/d.md")).toBe("other");
    expect(sourceOfPath("src/docs.md")).toBe("other");
  });
});

describe("formatDocTokens", () => {
  it("formatDocTokens 640 / 1000 -> 1K / 1234 -> 1.2K", () => {
    expect(formatDocTokens(640)).toBe("640");
    expect(formatDocTokens(1000)).toBe("1K");
    expect(formatDocTokens(1234)).toBe("1.2K");
    expect(formatDocTokens(3000)).toBe("3K");
    expect(formatDocTokens(0)).toBe("0");
  });
});

describe("buildRows", () => {
  it("row order: attached in order, then specs, docs, insights by path", () => {
    const rows = buildRows(DOCS, ["docs/b.md", "specs/a.md"]);
    expect(rows.map((r) => r.path)).toEqual([
      "docs/b.md",
      "specs/a.md",
      "specs/security-baseline.md",
      "docs/a.md",
      "insights/z.md",
    ]);
    expect(rows.slice(0, 2).every((r) => r.attached)).toBe(true);
    expect(rows.slice(2).every((r) => !r.attached)).toBe(true);
  });

  it("order across all five groups: attached, specs, docs, insights, root, other", () => {
    const docs = [
      doc("src/z.md", 1),
      doc("README.md", 1),
      doc("insights/i.md", 1),
      doc("docs/d.md", 1),
      doc("client/specs/x.md", 1),
      doc("specs/s.md", 1),
      doc("CONTRIBUTING.md", 1),
      doc("lib/a.md", 1),
    ];
    const rows = buildRows(docs, ["src/z.md"]);
    expect(rows.map((r) => r.path)).toEqual([
      "src/z.md",
      "client/specs/x.md",
      "specs/s.md",
      "docs/d.md",
      "insights/i.md",
      "CONTRIBUTING.md",
      "README.md",
      "lib/a.md",
    ]);
    expect(rows.map((r) => r.source)).toEqual(["other", "specs", "specs", "docs", "insights", "root", "root", "other"]);
  });

  it("an attached path missing from discovery is a stale row, kept in attached order", () => {
    const rows = buildRows(DOCS, ["specs/gone.md", "docs/b.md"]);
    expect(rows[0]).toMatchObject({
      path: "specs/gone.md",
      name: "gone.md",
      folder: "specs",
      stale: true,
      attached: true,
      tokens: null,
    });
    expect(rows[1]).toMatchObject({ path: "docs/b.md", stale: false });
  });

  it("when discovery is unavailable attached rows are unverified, not stale", () => {
    const rows = buildRows(undefined, ["specs/a.md"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ unverified: true, stale: false, attached: true });
  });

  it("inherited rows come first, read-only, labelled with the skill name", () => {
    const inherited: InheritedContextDoc[] = [
      { path: "docs/a.md", skill_id: "sk1", skill_name: "no-any" },
    ];
    const rows = buildRows(DOCS, ["specs/a.md"], inherited);
    expect(rows[0]).toMatchObject({
      kind: "inherited",
      path: "docs/a.md",
      viaSkill: "no-any",
      tokens: 20,
    });
    expect(rows[1]).toMatchObject({ kind: "attached", path: "specs/a.md" });
    // an inherited doc is not repeated in the unattached tail
    expect(rows.filter((r) => r.path === "docs/a.md")).toHaveLength(1);
  });
});

describe("filterRows", () => {
  it("matches name or folder case-insensitively; empty text keeps all", () => {
    const rows = buildRows(DOCS, []);
    expect(filterRows(rows, "SEC").map((r) => r.path)).toEqual(["specs/security-baseline.md"]);
    expect(filterRows(rows, "insights").map((r) => r.path)).toEqual(["insights/z.md"]);
    expect(filterRows(rows, "  ")).toHaveLength(rows.length);
    expect(filterRows(rows, "nope")).toEqual([]);
  });
});

describe("footerTotals", () => {
  it("footer totals: 400 + 1234 -> 2 files, 1.6K; stale excluded; inherited included", () => {
    const attached = ["specs/security-baseline.md", "docs/b.md", "specs/gone.md"];
    const t = footerTotals(buildRows(DOCS, attached));
    expect(t.files).toBe(2);
    expect(t.tokens).toBe(1634);
    expect(formatDocTokens(t.tokens)).toBe("1.6K");

    const withInherited = footerTotals(
      buildRows(DOCS, attached, [{ path: "docs/a.md", skill_id: "s", skill_name: "x" }]),
    );
    expect(withInherited.files).toBe(3);
    expect(withInherited.tokens).toBe(1654);
  });

  it("counts a path once when it is both inherited and attached", () => {
    const t = footerTotals(
      buildRows(DOCS, ["docs/a.md"], [{ path: "docs/a.md", skill_id: "s", skill_name: "x" }]),
    );
    expect(t).toMatchObject({ files: 1, tokens: 20 });
  });

  it("unverified rows are not counted", () => {
    expect(footerTotals(buildRows(undefined, ["specs/a.md"]))).toMatchObject({ files: 0, tokens: 0 });
  });

  it("soft cap only above 4000", () => {
    const big = (n: number) => footerTotals(buildRows([doc("docs/big.md", n)], ["docs/big.md"]));
    expect(big(4000).overCap).toBe(false);
    expect(big(4001).overCap).toBe(true);
  });
});

describe("serializeAs", () => {
  it("serializeAs groups and order", () => {
    const groups = serializeAs(["insights/i.md", "docs/d2.md", "specs/s.md", "docs/d1.md"]);
    expect(groups).toEqual([
      { source: "specs", heading: "## Project specifications", paths: ["specs/s.md"] },
      { source: "docs", heading: "## Project docs", paths: ["docs/d2.md", "docs/d1.md"] },
      { source: "insights", heading: "## Project insights", paths: ["insights/i.md"] },
    ]);
  });

  it("serializeAs puts root and other docs last under their own headings", () => {
    const groups = serializeAs(["src/o.md", "README.md", "client/specs/x.md", "docs/d.md"]);
    expect(groups).toEqual([
      { source: "specs", heading: "## Project specifications", paths: ["client/specs/x.md"] },
      { source: "docs", heading: "## Project docs", paths: ["docs/d.md"] },
      { source: "root", heading: "## Project root docs", paths: ["README.md"] },
      { source: "other", heading: "## Other project docs", paths: ["src/o.md"] },
    ]);
  });

  it("omits empty groups and renders exact text", () => {
    expect(serializeAs(["docs/d.md"])).toHaveLength(1);
    expect(serializeAsText(serializeAs(["docs/d.md", "specs/s.md"]))).toBe(
      "## Project specifications\n- specs/s.md\n\n## Project docs\n- docs/d.md",
    );
    expect(serializeAs([])).toEqual([]);
  });
});

describe("moveItem / reorderOnDrop", () => {
  it("moveItem moves immutably and clamps at the ends", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(list, 2, 3)).toEqual(["a", "b", "c"]);
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("reorderOnDrop only reorders attached ids", () => {
    const list = ["a", "b", "c"];
    expect(reorderOnDrop(list, "a", "c")).toEqual(["b", "c", "a"]);
    expect(reorderOnDrop(list, "a", "a")).toBeNull();
    expect(reorderOnDrop(list, "a", "x")).toBeNull();
    expect(reorderOnDrop(list, "x", "a")).toBeNull();
    expect(reorderOnDrop(list, "a", undefined)).toBeNull();
  });
});
