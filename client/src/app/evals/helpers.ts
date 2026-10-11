import type { EvalCaseResult, EvalSuiteRun } from "@devdigest/shared";

const RAN_AT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Human run time, e.g. "Oct 11, 2026, 10:00 AM". Falls back to the raw value if unparsable. */
export function formatRanAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : RAN_AT.format(d);
}

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

/** "X/Y" for the Cases passed column; null passed when the run has no counts. */
export function passedParts(run: Pick<EvalSuiteRun, "counts" | "cases_total">): { passed: number | null; total: number } {
  return { passed: run.counts?.cases_passed ?? null, total: run.cases_total };
}

export type CaseState = "pass" | "fail" | "error" | "pending";

/** Display state of one case result. */
export function caseState(r: Pick<EvalCaseResult, "status" | "pass">): CaseState {
  if (r.status === "error") return "error";
  if (r.status === "pending" || r.pass == null) return "pending";
  return r.pass ? "pass" : "fail";
}

/** AC-66: toggle a run in the ordered selection; a third pick replaces the earliest one. */
export function toggleSelection(selected: readonly string[], id: string, max: number): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  const next = [...selected, id];
  return next.length > max ? next.slice(next.length - max) : next;
}
