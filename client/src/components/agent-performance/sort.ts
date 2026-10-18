import type { AgentStats } from "@devdigest/shared";
import { LOW_SAMPLE_MIN } from "./constants";

export type SortKey = "agent" | "runs" | "cost" | "duration" | "accept" | "lastRun";
export type SortDir = "asc" | "desc";
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: SortState = { key: "runs", dir: "desc" };

/** Header activation: same key toggles, a new key starts asc for names and desc for numbers. */
export function nextSort(cur: SortState, key: SortKey): SortState {
  if (cur.key === key) return { key, dir: cur.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "agent" ? "asc" : "desc" };
}

const byName = (a: AgentStats, b: AgentStats) =>
  a.agent_name.localeCompare(b.agent_name, "en", { sensitivity: "base" }) ||
  (a.agent_name < b.agent_name ? -1 : a.agent_name > b.agent_name ? 1 : 0) ||
  (a.agent_id < b.agent_id ? -1 : a.agent_id > b.agent_id ? 1 : 0);

const sign = (dir: SortDir) => (dir === "asc" ? 1 : -1);

/** Nulls last in both directions (AC-49). */
function nullable(get: (a: AgentStats) => number | null, dir: SortDir) {
  return (a: AgentStats, b: AgentStats) => {
    const x = get(a);
    const y = get(b);
    if (x === null && y === null) return byName(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return (x - y) * sign(dir) || byName(a, b);
  };
}

/** Enough decisions first (by rate), then low sample (decisions desc, name), then n/a (name); AC-48. */
function accept(dir: SortDir) {
  const tier = (a: AgentStats) => (a.decisions >= LOW_SAMPLE_MIN ? 0 : a.decisions > 0 ? 1 : 2);
  return (a: AgentStats, b: AgentStats) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;
    if (ta === 0) {
      return ((a.accept_rate ?? 0) - (b.accept_rate ?? 0)) * sign(dir) || b.decisions - a.decisions || byName(a, b);
    }
    if (ta === 1) return b.decisions - a.decisions || byName(a, b);
    return byName(a, b);
  };
}

export function sortAgents(agents: readonly AgentStats[], sort: SortState): AgentStats[] {
  const { key, dir } = sort;
  let cmp: (a: AgentStats, b: AgentStats) => number;
  switch (key) {
    case "agent":
      cmp = (a, b) => byName(a, b) * sign(dir);
      break;
    case "runs":
      cmp = (a, b) => (a.runs - b.runs) * sign(dir) || byName(a, b);
      break;
    case "cost":
      cmp = nullable((a) => a.avg_cost_usd, dir);
      break;
    case "duration":
      cmp = nullable((a) => a.avg_latency_ms, dir);
      break;
    case "lastRun":
      cmp = nullable((a) => (a.last_run_at ? Date.parse(a.last_run_at) : null), dir);
      break;
    case "accept":
      cmp = accept(dir);
      break;
  }
  return [...agents].sort(cmp);
}
