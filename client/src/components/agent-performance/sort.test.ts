import { describe, it, expect } from "vitest";
import type { AgentStats } from "@devdigest/shared";
import sample from "@/test/fixtures/agent-performance.sample.json";
import { DEFAULT_SORT, nextSort, sortAgents } from "./sort";

const base = sample.agents[0] as unknown as AgentStats;
function mk(name: string, over: Partial<AgentStats> = {}): AgentStats {
  return { ...base, agent_id: `id-${name}`, agent_name: name, ...over };
}
const names = (xs: AgentStats[]) => xs.map((a) => a.agent_name);

describe("default sort", () => {
  it("is runs descending, ties by name ascending", () => {
    const xs = [mk("b", { runs: 2 }), mk("c", { runs: 5 }), mk("a", { runs: 2 }), mk("z", { runs: 0 })];
    expect(DEFAULT_SORT).toEqual({ key: "runs", dir: "desc" });
    expect(names(sortAgents(xs, DEFAULT_SORT))).toEqual(["c", "a", "b", "z"]);
  });
  it("does not mutate its input", () => {
    const xs = [mk("b"), mk("a")];
    sortAgents(xs, { key: "agent", dir: "asc" });
    expect(names(xs)).toEqual(["b", "a"]);
  });
});

describe("nextSort", () => {
  it("toggles direction on the same key and starts agent asc, others desc", () => {
    expect(nextSort(DEFAULT_SORT, "runs")).toEqual({ key: "runs", dir: "asc" });
    expect(nextSort({ key: "runs", dir: "asc" }, "runs")).toEqual({ key: "runs", dir: "desc" });
    expect(nextSort(DEFAULT_SORT, "agent")).toEqual({ key: "agent", dir: "asc" });
    expect(nextSort(DEFAULT_SORT, "cost")).toEqual({ key: "cost", dir: "desc" });
  });
});

describe("accept-rate sort", () => {
  const xs = [
    mk("low", { accept_rate: 1, accepted: 1, decisions: 1 }),
    mk("big", { accept_rate: 0.6, accepted: 6, decisions: 10 }),
    mk("none-b", { accept_rate: null, accepted: 0, decisions: 0 }),
    mk("none-a", { accept_rate: null, accepted: 0, decisions: 0 }),
    mk("mid", { accept_rate: 0.5, accepted: 2, decisions: 4 }),
    mk("top", { accept_rate: 0.9, accepted: 9, decisions: 10 }),
  ];
  it("desc: enough decisions by rate, then low sample by decisions, then n/a by name", () => {
    expect(names(sortAgents(xs, { key: "accept", dir: "desc" }))).toEqual(["top", "big", "mid", "low", "none-a", "none-b"]);
  });
  it("asc: a 1/1 agent stays below a 6/10 agent in both directions", () => {
    const asc = names(sortAgents(xs, { key: "accept", dir: "asc" }));
    expect(asc).toEqual(["big", "top", "mid", "low", "none-a", "none-b"]);
    expect(asc.indexOf("low")).toBeGreaterThan(asc.indexOf("big"));
  });
});

describe("null values go last in both directions", () => {
  const xs = [
    mk("a", { avg_cost_usd: null, avg_latency_ms: null, last_run_at: null }),
    mk("b", { avg_cost_usd: 0.002, avg_latency_ms: 3000, last_run_at: "2026-10-01T00:00:00.000Z" }),
    mk("c", { avg_cost_usd: 0.001, avg_latency_ms: 9000, last_run_at: "2026-10-05T00:00:00.000Z" }),
  ];
  it.each([
    ["cost", ["b", "c", "a"], ["c", "b", "a"]],
    ["duration", ["c", "b", "a"], ["b", "c", "a"]],
    ["lastRun", ["c", "b", "a"], ["b", "c", "a"]],
  ] as const)("%s", (key, desc, asc) => {
    expect(names(sortAgents(xs, { key, dir: "desc" }))).toEqual(desc);
    expect(names(sortAgents(xs, { key, dir: "asc" }))).toEqual(asc);
  });
});

describe("agent sort", () => {
  it("is case-insensitive by name", () => {
    const xs = [mk("beta"), mk("Alpha"), mk("gamma")];
    expect(names(sortAgents(xs, { key: "agent", dir: "asc" }))).toEqual(["Alpha", "beta", "gamma"]);
    expect(names(sortAgents(xs, { key: "agent", dir: "desc" }))).toEqual(["gamma", "beta", "Alpha"]);
  });
});
