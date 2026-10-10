import { describe, it, expect } from "vitest";
import type { RunTrace } from "@devdigest/shared";
import { normalizeSpecsRead, projectContextEntries, specsTokenSummary } from "./helpers";

const base = {
  prompt_assembly: { system: "s", skills: null, memory: null, specs: null, user: "u" },
  specs_read: [],
} as unknown as RunTrace;

describe("normalizeSpecsRead", () => {
  it("legacy strings -> paths without tokens", () => {
    expect(normalizeSpecsRead(["specs/a.md", "docs/b.md"])).toEqual([
      { path: "specs/a.md", tokens: null, status: "injected", reason: null, origin: "agent", skillName: null },
      { path: "docs/b.md", tokens: null, status: "injected", reason: null, origin: "agent", skillName: null },
    ]);
  });

  it("entries keep status, reason, tokens and skill name", () => {
    const rows = normalizeSpecsRead([
      { path: "specs/a.md", tokens: 512, status: "injected", origin: "skill", skill_name: "Sec" },
      { path: "docs/gone.md", tokens: null, status: "skipped", reason: "not_found", origin: "agent" },
    ]);
    expect(rows[0]).toMatchObject({ tokens: 512, status: "injected", reason: null, origin: "skill", skillName: "Sec" });
    expect(rows[1]).toMatchObject({ status: "skipped", reason: "not_found", tokens: null, skillName: null });
  });

  it("undefined/odd input -> empty", () => {
    expect(normalizeSpecsRead(undefined)).toEqual([]);
  });
});

describe("projectContextEntries", () => {
  it("legacy specs string -> one entry", () => {
    const t = { ...base, prompt_assembly: { ...base.prompt_assembly, specs: "legacy specs text" } } as RunTrace;
    expect(projectContextEntries(t)).toEqual([{ path: null, tokens: null, text: "legacy specs text" }]);
  });

  it("blocks win over the legacy string and keep order", () => {
    const t = {
      ...base,
      prompt_assembly: {
        ...base.prompt_assembly,
        specs: "legacy",
        project_context_blocks: [
          { path: "specs/a.md", tokens: 3, text: "<untrusted source=\"specs/a.md\">A</untrusted>" },
          { path: "docs/b.md", tokens: 4, text: "B" },
        ],
      },
    } as RunTrace;
    expect(projectContextEntries(t).map((e) => e.path)).toEqual(["specs/a.md", "docs/b.md"]);
  });

  it("none -> empty", () => {
    expect(projectContextEntries(base)).toEqual([]);
  });
});

describe("specsTokenSummary", () => {
  it("uses the stored total, else sums injected rows; flags above 4000 only", () => {
    const rows = normalizeSpecsRead([
      { path: "specs/a.md", tokens: 2500, status: "injected", origin: "agent" },
      { path: "specs/b.md", tokens: 1500, status: "injected", origin: "agent" },
      { path: "specs/c.md", tokens: 9000, status: "skipped", reason: "over_budget", origin: "agent" },
    ]);
    expect(specsTokenSummary(rows, undefined)).toEqual({ tokens: 4000, softCapExceeded: false });
    expect(specsTokenSummary(rows, { commit_sha: "x", injected_tokens: 4001, soft_cap_exceeded: true })).toEqual({
      tokens: 4001,
      softCapExceeded: true,
    });
  });
});
