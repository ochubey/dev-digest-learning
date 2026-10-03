import { describe, it, expect } from "vitest";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
import { groupFiles } from "./helpers";

const pf = (path: string): PrFile => ({ path, additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+x" });
const sf = (path: string, finding_lines: number[] = []) => ({
  path,
  additions: 1,
  deletions: 0,
  finding_lines,
});
const fnd = (id: string, file: string): FindingRecord => ({
  id,
  severity: "WARNING",
  category: "bug",
  title: id,
  file,
  start_line: 1,
  end_line: 1,
  rationale: "r",
  confidence: 0.9,
  review_id: "r",
  accepted_at: null,
  dismissed_at: null,
});
const sd = (groups: SmartDiff["groups"]): SmartDiff => ({
  groups,
  split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
});

describe("groupFiles", () => {
  it("maps PR files to groups by path, keeping server order within a group", () => {
    const files = [pf("a.ts"), pf("b.ts"), pf("c.md")];
    const groups = groupFiles(
      files,
      sd([
        { role: "core", files: [sf("b.ts"), sf("a.ts")] },
        { role: "docs", files: [sf("c.md")] },
      ]),
    );
    expect(groups.map((g) => g.role)).toEqual(["core", "docs"]);
    expect(groups[0]!.files.map((f) => f.path)).toEqual(["b.ts", "a.ts"]);
    expect(groups[1]!.files.map((f) => f.path)).toEqual(["c.md"]);
  });

  it("preserves the server group order (no client re-sorting)", () => {
    const groups = groupFiles(
      [pf("a"), pf("b")],
      sd([
        { role: "docs", files: [sf("b")] },
        { role: "core", files: [sf("a")] },
      ]),
    );
    expect(groups.map((g) => g.role)).toEqual(["docs", "core"]);
  });

  it("puts files missing from the response into core (appended after server core files)", () => {
    const groups = groupFiles(
      [pf("a.ts"), pf("new.ts"), pf("t.test.ts")],
      sd([
        { role: "core", files: [sf("a.ts")] },
        { role: "tests", files: [sf("t.test.ts")] },
      ]),
    );
    expect(groups[0]!.role).toBe("core");
    expect(groups[0]!.files.map((f) => f.path)).toEqual(["a.ts", "new.ts"]);
  });

  it("creates a core group when only unknown files exist", () => {
    const groups = groupFiles([pf("x.ts")], sd([]));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.role).toBe("core");
    expect(groups[0]!.files.map((f) => f.path)).toEqual(["x.ts"]);
  });

  it("ignores response entries that are not in the PR files and drops empty groups", () => {
    const groups = groupFiles(
      [pf("a.ts")],
      sd([
        { role: "core", files: [sf("a.ts")] },
        { role: "docs", files: [sf("gone.md")] },
      ]),
    );
    expect(groups.map((g) => g.role)).toEqual(["core"]);
  });

  it("inserts a core group at the FRONT for missing files when the response has none", () => {
    const groups = groupFiles(
      [pf("t.test.ts"), pf("x.ts")],
      sd([{ role: "tests", files: [sf("t.test.ts")] }]),
    );
    expect(groups.map((g) => g.role)).toEqual(["core", "tests"]);
    expect(groups[0]!.files.map((f) => f.path)).toEqual(["x.ts"]);
  });

  it("counts files with visible findings from the given findings, not from finding_lines", () => {
    const groups = groupFiles(
      [pf("a"), pf("b"), pf("c")],
      sd([{ role: "core", files: [sf("a", [1, 2]), sf("b"), sf("c")] }]),
      [fnd("1", "b"), fnd("2", "b"), fnd("3", "c")],
    );
    expect(groups[0]!.findingFiles).toBe(2);
  });

  it("counts no files when there are no findings, even if finding_lines is set", () => {
    const groups = groupFiles(
      [pf("a")],
      sd([{ role: "core", files: [sf("a", [1])] }]),
      [],
    );
    expect(groups[0]!.findingFiles).toBe(0);
  });

  it("counts findings on files missing from the response (they land in core)", () => {
    const groups = groupFiles([pf("new.ts")], sd([]), [fnd("1", "new.ts")]);
    expect(groups[0]!.findingFiles).toBe(1);
  });
});
