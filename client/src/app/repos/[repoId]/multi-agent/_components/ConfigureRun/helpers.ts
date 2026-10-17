/** Pure helpers for ConfigureRun (also used by the dropdown and the results page). */
import type { Agent, AgentRunEstimate, PrMeta } from "@devdigest/shared";
import { AGENT_ACCENTS, MAX_AGENTS } from "./constants";

export type RunButtonState = "select" | "one" | "many";

/** PRs by number, highest first. */
export function sortPullsNewestFirst<T extends Pick<PrMeta, "number">>(pulls: T[]): T[] {
  return pulls.slice().sort((a, b) => b.number - a.number);
}

/** Preset ids (known agents only, card order, capped) win; else the first enabled agents. */
export function defaultSelection(
  agents: Pick<Agent, "id" | "enabled">[],
  presetIds: string[] = [],
): string[] {
  if (presetIds.length > 0) {
    const preset = new Set(presetIds);
    return agents
      .filter((a) => preset.has(a.id))
      .slice(0, MAX_AGENTS)
      .map((a) => a.id);
  }
  return agents
    .filter((a) => a.enabled)
    .slice(0, MAX_AGENTS)
    .map((a) => a.id);
}

/** 1 decimal, e.g. 9.1. */
export function formatSeconds(seconds: number): string {
  return seconds.toFixed(1);
}

/** 2 decimals; 4 decimals below one cent. */
export function formatUsd(usd: number): string {
  return usd > 0 && usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2);
}

/** "≈ 9.1s · $0.18" (cost omitted when unknown), or null when the agent has no history. */
export function agentEstimateLabel(est: AgentRunEstimate | undefined): string | null {
  if (!est || est.sample_size <= 0 || est.avg_duration_ms == null) return null;
  const time = `≈ ${formatSeconds(est.avg_duration_ms / 1000)}s`;
  return est.avg_cost_usd == null ? time : `${time} · $${formatUsd(est.avg_cost_usd)}`;
}

/** Parallel estimate: T = slowest average, C = summed average costs, over agents with history. */
export function selectionEstimate(
  selectedIds: string[],
  estimates: AgentRunEstimate[],
): { seconds: number; cost: number; withoutHistory: number } {
  const byId = new Map(estimates.map((e) => [e.agent_id, e]));
  let seconds = 0;
  let cost = 0;
  let withoutHistory = 0;
  for (const id of selectedIds) {
    const est = byId.get(id);
    if (!est || est.sample_size <= 0) {
      withoutHistory += 1;
      continue;
    }
    seconds = Math.max(seconds, (est.avg_duration_ms ?? 0) / 1000);
    cost += est.avg_cost_usd ?? 0;
  }
  return { seconds, cost, withoutHistory };
}

export function runButtonState(count: number): RunButtonState {
  return count <= 0 ? "select" : count === 1 ? "one" : "many";
}

/** Configure run URL; `pr` is the PR number, `agents` the preselected agent ids. */
export function configureRunHref(
  repoId: string,
  opts: { pr?: number | null; agents?: string[] } = {},
): string {
  const sp = new URLSearchParams();
  if (opts.pr != null) sp.set("pr", String(opts.pr));
  if (opts.agents && opts.agents.length > 0) sp.set("agents", opts.agents.join(","));
  const qs = sp.toString();
  return `/repos/${repoId}/multi-agent${qs ? `?${qs}` : ""}`;
}

/** Results page URL of one multi-agent run. */
export function resultsHref(repoId: string, id: string, view?: "columns" | "tabs"): string {
  return `/repos/${repoId}/multi-agent/${id}${view ? `?view=${view}` : ""}`;
}

/** Stable accent for an agent: hash of its id (or name) into the palette. */
export function agentAccent(key: string): { color: string; bg: string } {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AGENT_ACCENTS[h % AGENT_ACCENTS.length]!;
}
