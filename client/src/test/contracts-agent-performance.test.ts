import { describe, it, expect } from "vitest";
import { AgentStats } from "@devdigest/shared";
import sample from "./fixtures/agent-performance.sample.json";
import type { AgentPerformance } from "../components/agent-performance/types";

// Keys of the mirrored envelope, written out so a field added on one side only fails here.
const ENVELOPE_KEYS = ["agents", "cost_basis", "cost_by_agent", "cost_by_model", "most_active", "period", "totals"];
const TOTALS_KEYS = [
  "accept_rate", "accepted", "decisions", "deleted_agent_runs", "dismissed", "low_sample",
  "runs", "runs_excluded", "runs_with_cost", "runs_without_cost", "total_cost_usd",
];

describe("client mirror of the agent-performance envelope", () => {
  const data = sample as unknown as AgentPerformance;

  it("fixture has exactly the mirrored envelope and totals keys", () => {
    expect(Object.keys(sample).sort()).toEqual(ENVELOPE_KEYS);
    expect(Object.keys(sample.totals).sort()).toEqual(TOTALS_KEYS);
    expect(data.cost_basis).toBe("estimate");
  });

  it("every agent entry satisfies the shared AgentStats contract", () => {
    for (const a of data.agents) expect(AgentStats.safeParse(a).success).toBe(true);
  });

  it("breakdown entries carry the mirrored fields", () => {
    expect(Object.keys(sample.cost_by_agent[0]!).sort()).toEqual(["agent_id", "agent_name", "cost_usd", "runs_with_cost"]);
    expect(Object.keys(sample.cost_by_model[0]!).sort()).toEqual(["cost_usd", "model", "runs_with_cost"]);
    expect(Object.keys(sample.most_active!).sort()).toEqual(["agent_id", "agent_name", "runs"]);
  });
});
