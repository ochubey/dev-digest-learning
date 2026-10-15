import { describe, it, expect } from "vitest";
import type { AgentColumnFinding, FindingGroup } from "@devdigest/shared";
import { alsoFlaggedBy, groupsToShow, parseView, finishedCount, isTerminal, statusKey } from "./helpers";

const member = (id: string, runId: string, agent: string): AgentColumnFinding => ({
  id,
  agent_id: `ag-${agent}`,
  agent_name: agent,
  run_id: runId,
  severity: "WARNING",
  category: "security",
  title: "t",
  file: "a.ts",
  start_line: 1,
  end_line: 1,
});
const group = (id: string, members: AgentColumnFinding[], takes: number, is_conflict: boolean): FindingGroup => ({
  id,
  file: "a.ts",
  start_line: 1,
  end_line: 1,
  title: id,
  members,
  takes: Array.from({ length: takes }, (_, i) => ({
    agent_id: `x${i}`,
    run_id: `r${i}`,
    persona: `P${i}`,
    verdict: "WARNING" as const,
    note: "",
  })),
  is_conflict,
});

describe("MultiAgentResults helpers", () => {
  it("alsoFlaggedBy lists only other agents", () => {
    const groups = [
      group("g1", [member("f1", "r1", "Security"), member("f2", "r2", "Perf")], 2, false),
      group("g2", [member("f3", "r1", "Security")], 1, false),
    ];
    const map = alsoFlaggedBy(groups);
    expect(map.get("f1")).toEqual(["Perf"]);
    expect(map.get("f2")).toEqual(["Security"]);
    expect(map.has("f3")).toBe(false);
  });

  it("groupsToShow off = all with takes, on = conflicts only", () => {
    const groups = [
      group("agree", [], 2, false),
      group("conflict", [], 2, true),
      group("empty", [], 0, false),
    ];
    expect(groupsToShow(groups, false).map((g) => g.id)).toEqual(["agree", "conflict"]);
    expect(groupsToShow(groups, true).map((g) => g.id)).toEqual(["conflict"]);
  });

  it("invalid ?view falls back to columns", () => {
    expect(parseView("tabs")).toBe("tabs");
    expect(parseView("columns")).toBe("columns");
    expect(parseView("grid")).toBe("columns");
    expect(parseView(null)).toBe("columns");
    expect(parseView(undefined)).toBe("columns");
  });

  it("status helpers: terminal, finished count, status key", () => {
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("failed")).toBe(true);
    expect(finishedCount([{ status: "done" }, { status: "running" }, { status: "failed" }])).toBe(1);
    expect(statusKey("cancelled")).toBe("cancelled");
    expect(statusKey("weird")).toBe("failed");
  });
});
