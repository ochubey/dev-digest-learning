export { formatRanAt, passedParts, caseState, type CaseState } from "@/components/evals/helpers";

/** Dollars with four decimals, or "—" when the cost is unknown. */
export function formatCost(v: number | null | undefined): string {
  return v == null ? "—" : `$${v.toFixed(4)}`;
}

/** AC-68: cost delta B - A with ▲/▼ text; null when either side is unknown. */
export function costDelta(a: number | null | undefined, b: number | null | undefined): string | null {
  if (a == null || b == null) return null;
  const d = Math.round((b - a) * 10_000) / 10_000;
  if (d === 0) return "$0.0000";
  return `${d > 0 ? "▲" : "▼"} $${Math.abs(d).toFixed(4)}`;
}

/** AC-66: toggle a run in the ordered selection; a third pick replaces the earliest one. */
export function toggleSelection(selected: readonly string[], id: string, max: number): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  const next = [...selected, id];
  return next.length > max ? next.slice(next.length - max) : next;
}
