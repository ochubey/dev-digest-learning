import type { EvalSuiteRun } from "@devdigest/shared";
import { RECENT_RUNS_LIMIT } from "../../constants";

/** AC-60: the newest runs across agents, newest first. Returns a new array. */
export function recentRuns<T extends Pick<EvalSuiteRun, "started_at">>(runs: readonly T[], limit = RECENT_RUNS_LIMIT): T[] {
  return [...runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, limit);
}

/** Number of finished runs feeding a landing-row sparkline. */
export const TREND_RUNS = 8;

/** Recall of the agent's last finished runs, oldest first (sparkline input). */
export function recallTrend(runs: readonly EvalSuiteRun[], limit = TREND_RUNS): (number | null)[] {
  return runs
    .filter((r) => r.status === "completed" || r.status === "completed_with_errors")
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
    .slice(-limit)
    .map((r) => r.metrics.recall);
}
