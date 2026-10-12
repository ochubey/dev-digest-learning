import type { EvalRunPage, EvalSuiteRun } from "@devdigest/shared";
import { RUN_HISTORY_LIMIT } from "./constants";

/** Newest `limit` runs across the loaded pages (the API returns newest first). */
export function recentRuns(pages: EvalRunPage[] | undefined, limit = RUN_HISTORY_LIMIT): EvalSuiteRun[] {
  return (pages ?? []).flatMap((p) => p.items).slice(0, limit);
}

/** AC-18: X = cases passed, Y = cases scored in the latest finished run; null without counts. */
export function passingParts(run: Pick<EvalSuiteRun, "counts"> | null): { passed: number; scored: number } | null {
  if (!run?.counts) return null;
  return { passed: run.counts.cases_passed, scored: run.counts.cases_scored };
}

/** "$0.0123" for a cost, or null. */
export function formatCost(v: number | null | undefined): string | null {
  return v == null ? null : `$${v.toFixed(v < 1 ? 4 : 2)}`;
}

/** Local date-time for a run start, e.g. "11 Oct 2026, 10:00". */
export function formatRanAt(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}
