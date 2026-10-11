/** Pure helpers for the multi-agent results page and its parts. */
import type { AgentColumn, FindingGroup } from "@devdigest/shared";
import { DEFAULT_VIEW, VIEWS, type ResultsView } from "./constants";

export type ColumnStatus = AgentColumn["status"];

/** A column is terminal once it is no longer running. */
export function isTerminal(status: ColumnStatus): boolean {
  return status !== "running";
}

/** Columns that finished successfully. */
export function finishedCount(columns: Pick<AgentColumn, "status">[]): number {
  return columns.filter((c) => c.status === "done").length;
}

/** i18n key suffix of a status (`results.status.<key>`); unknown values read as failed. */
export function statusKey(status: string): ColumnStatus {
  return status === "running" || status === "done" || status === "cancelled" ? status : "failed";
}

/** For every grouped finding: the names of the OTHER agents that flagged the same group. */
export function alsoFlaggedBy(groups: FindingGroup[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const g of groups) {
    for (const m of g.members) {
      const others = new Set<string>();
      for (const o of g.members) if (o.run_id !== m.run_id) others.add(o.agent_name);
      if (others.size > 0) out.set(m.id, [...others]);
    }
  }
  return out;
}

/** Groups with at least one take, or only the conflicting ones. */
export function groupsToShow(groups: FindingGroup[], onlyConflicts: boolean): FindingGroup[] {
  return groups.filter((g) => (onlyConflicts ? g.is_conflict : g.takes.length > 0));
}

/** Invalid or missing `?view` falls back to columns. */
export function parseView(raw: string | null | undefined): ResultsView {
  return (VIEWS as readonly string[]).includes(raw ?? "") ? (raw as ResultsView) : DEFAULT_VIEW;
}

/** "9.1s" or "—" while the value is unknown. */
export function formatDuration(ms: number | null | undefined): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

/** "$0.18" (4 decimals below one cent) or "—". */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "—";
  return `$${usd > 0 && usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
