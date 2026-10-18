import type { CostByAgent, CostByModel } from "./types";

export interface BreakdownEntry {
  key: string;
  label: string;
  cost_usd: number;
}
export interface BreakdownItem extends BreakdownEntry {
  /** 0..1 of the server total, from unrounded values. */
  share: number;
}

/**
 * Shares are `cost / serverTotal` on unrounded numbers; the footer shows the
 * server total, never a sum of rounded entries (AC-56). No total means no list.
 */
export function buildBreakdown(entries: readonly BreakdownEntry[], total: number | null): BreakdownItem[] {
  if (total === null || total <= 0) return [];
  return entries
    .map((e) => ({ ...e, share: e.cost_usd / total }))
    .sort((a, b) => b.cost_usd - a.cost_usd || a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
}

export const agentEntries = (xs: readonly CostByAgent[]): BreakdownEntry[] =>
  xs.map((x) => ({ key: x.agent_id, label: x.agent_name, cost_usd: x.cost_usd }));

export const modelEntries = (xs: readonly CostByModel[]): BreakdownEntry[] =>
  xs.map((x) => ({ key: x.model, label: x.model, cost_usd: x.cost_usd }));
