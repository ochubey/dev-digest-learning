import { describe, it, expect } from "vitest";
import type { AgentRunEstimate } from "@devdigest/shared";
import {
  agentEstimateLabel,
  configureRunHref,
  defaultSelection,
  formatSeconds,
  formatUsd,
  resultsHref,
  runButtonState,
  selectionEstimate,
  sortPullsNewestFirst,
} from "./helpers";

const est = (
  agent_id: string,
  sample_size: number,
  avg_duration_ms: number | null,
  avg_cost_usd: number | null,
): AgentRunEstimate => ({ agent_id, sample_size, avg_duration_ms, avg_cost_usd });

describe("ConfigureRun helpers", () => {
  it("selectionEstimate: three agents, one without history -> T, C, suffix count 1", () => {
    const r = selectionEstimate(
      ["a", "b", "c"],
      [est("a", 3, 9100, 0.18), est("b", 2, 4000, 0.05), est("c", 0, null, null)],
    );
    expect(r.seconds).toBeCloseTo(9.1);
    expect(r.cost).toBeCloseTo(0.23);
    expect(r.withoutHistory).toBe(1);
  });

  it("agentEstimateLabel both forms", () => {
    expect(agentEstimateLabel(est("a", 3, 9100, 0.18))).toBe("≈ 9.1s · $0.18");
    expect(agentEstimateLabel(est("a", 3, 9100, null))).toBe("≈ 9.1s");
    expect(agentEstimateLabel(est("a", 0, null, null))).toBeNull();
    expect(agentEstimateLabel(undefined)).toBeNull();
  });

  it("sortPullsNewestFirst", () => {
    const input = [{ number: 3 }, { number: 12 }, { number: 7 }];
    expect(sortPullsNewestFirst(input).map((p) => p.number)).toEqual([12, 7, 3]);
    expect(input.map((p) => p.number)).toEqual([3, 12, 7]); // input not mutated
  });

  it("defaultSelection: preset ids win, else first 5 enabled", () => {
    const agents = [
      { id: "a1", enabled: true },
      { id: "a2", enabled: false },
      { id: "a3", enabled: true },
      { id: "a4", enabled: true },
      { id: "a5", enabled: true },
      { id: "a6", enabled: true },
      { id: "a7", enabled: true },
    ];
    expect(defaultSelection(agents, ["a2", "a6"])).toEqual(["a2", "a6"]);
    expect(defaultSelection(agents, [])).toEqual(["a1", "a3", "a4", "a5", "a6"]);
    expect(defaultSelection(agents)).toEqual(["a1", "a3", "a4", "a5", "a6"]);
  });

  it("configureRunHref encodes pr and agents", () => {
    expect(configureRunHref("r1")).toBe("/repos/r1/multi-agent");
    expect(configureRunHref("r1", { pr: 482 })).toBe("/repos/r1/multi-agent?pr=482");
    expect(configureRunHref("r1", { pr: 482, agents: ["a", "b"] })).toBe(
      "/repos/r1/multi-agent?pr=482&agents=a%2Cb",
    );
    expect(resultsHref("r1", "m1")).toBe("/repos/r1/multi-agent/m1");
    expect(resultsHref("r1", "m1", "tabs")).toBe("/repos/r1/multi-agent/m1?view=tabs");
  });

  it("formats seconds, USD and the run button state", () => {
    expect(formatSeconds(9.14)).toBe("9.1");
    expect(formatUsd(0.18)).toBe("0.18");
    expect(formatUsd(0.0042)).toBe("0.0042");
    expect(runButtonState(0)).toBe("select");
    expect(runButtonState(1)).toBe("one");
    expect(runButtonState(4)).toBe("many");
  });
});
