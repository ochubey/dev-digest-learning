import type { EvalSuiteRun } from "@devdigest/shared";
import { latestFinished, previousFinished, type EvalMetricKey } from "@/components/evals";

export const RANGES = ["7d", "30d", "90d", "all"] as const;
export type RangeKey = (typeof RANGES)[number];
export const DEFAULT_RANGE: RangeKey = "all";
const RANGE_DAYS: Record<Exclude<RangeKey, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const DAY_MS = 86_400_000;
export const SPARKLINE_RUNS = 8;

/** Keeps runs started inside the range (by `started_at`); "all" keeps everything. */
export function filterByRange<T extends Pick<EvalSuiteRun, "started_at">>(runs: readonly T[], range: RangeKey, now: number): T[] {
  if (range === "all") return [...runs];
  const from = now - RANGE_DAYS[range] * DAY_MS;
  return runs.filter((r) => {
    const at = Date.parse(r.started_at);
    return Number.isNaN(at) || at >= from;
  });
}

export const METRIC_KEYS = ["recall", "precision", "citation_accuracy"] as const satisfies readonly EvalMetricKey[];
export type MetricName = "recall" | "precision" | "citation";
export const METRIC_NAME: Record<EvalMetricKey, MetricName> = { recall: "recall", precision: "precision", citation_accuracy: "citation" };

const FINISHED = new Set(["completed", "completed_with_errors"]);

/** Value of a metric (or the passed/scored ratio) for the last `n` finished runs, oldest first. */
export function recentSeries(runs: readonly EvalSuiteRun[], key: EvalMetricKey | "passed", n = SPARKLINE_RUNS): (number | null)[] {
  return runs
    .filter((r) => FINISHED.has(r.status))
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
    .slice(-n)
    .map((r) => {
      if (key !== "passed") return r.metrics[key];
      const scored = r.counts?.cases_scored ?? 0;
      return r.counts && scored > 0 ? r.counts.cases_passed / scored : null;
    });
}

export interface Regression {
  version: number;
  dropped: { key: EvalMetricKey; pt: number }[];
  others: { key: EvalMetricKey; kind: "up" | "flat"; pt: number }[];
}

/** Newest finished run vs the previous one, in whole percentage points; null when nothing dropped. */
export function regression(runs: readonly EvalSuiteRun[]): Regression | null {
  const latest = latestFinished(runs);
  const previous = previousFinished(runs);
  if (!latest || !previous) return null;
  const out: Regression = { version: latest.agent_version, dropped: [], others: [] };
  for (const key of METRIC_KEYS) {
    const a = latest.metrics[key];
    const b = previous.metrics[key];
    if (a == null || b == null) continue;
    const d = Math.round(a * 100) - Math.round(b * 100);
    if (d < 0) out.dropped.push({ key, pt: -d });
    else out.others.push({ key, kind: d > 0 ? "up" : "flat", pt: d });
  }
  return out.dropped.length > 0 ? out : null;
}
