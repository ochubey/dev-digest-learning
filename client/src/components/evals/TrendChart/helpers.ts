import type { EvalSuiteRun } from "@devdigest/shared";
import type { EvalMetricKey } from "../helpers";

export const TREND_SERIES: { key: EvalMetricKey; name: "recall" | "precision" | "citation"; color: string }[] = [
  { key: "recall", name: "recall", color: "var(--accent)" },
  { key: "precision", name: "precision", color: "var(--ok)" },
  { key: "citation_accuracy", name: "citation", color: "var(--warn)" },
];

/** Finished runs (completed or completed with errors), oldest first. */
export function finishedChronological(runs: readonly EvalSuiteRun[]): EvalSuiteRun[] {
  return runs
    .filter((r) => r.status === "completed" || r.status === "completed_with_errors")
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}

/** Y range with a little padding, snapped to 10% steps and kept inside 0..1 (at least 20pt tall). */
export function yRange(values: readonly number[]): { lo: number; hi: number } {
  if (values.length === 0) return { lo: 0, hi: 1 };
  let lo = Math.max(0, Math.floor((Math.min(...values) - 0.05) * 10) / 10);
  let hi = Math.min(1, Math.ceil((Math.max(...values) + 0.05) * 10) / 10);
  if (hi - lo < 0.2) {
    if (hi >= 1) lo = Math.max(0, hi - 0.2);
    else hi = Math.min(1, lo + 0.2);
  }
  return { lo, hi };
}

/** Gridline values (0..1) inside the range: every 25pt on a wide range, every 10pt/5pt on a narrow one. */
export function gridlines(lo: number, hi: number): number[] {
  const span = hi - lo;
  const step = span > 0.5 ? 0.25 : span > 0.2 ? 0.1 : 0.05;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100 + 0);
  return out;
}

/** Indexes whose x label is shown, thinned so labels never overlap. */
export function labelIndexes(count: number, max = 10): Set<number> {
  const every = Math.max(1, Math.ceil(count / max));
  const out = new Set<number>();
  for (let i = 0; i < count; i += every) out.add(i);
  out.add(count - 1);
  return out;
}
