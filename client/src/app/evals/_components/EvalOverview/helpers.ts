import type { EvalSuiteRun } from "@devdigest/shared";
import { RECENT_RUNS_LIMIT } from "../../constants";

/** AC-60: the newest runs across agents, newest first. Returns a new array. */
export function recentRuns<T extends Pick<EvalSuiteRun, "started_at">>(runs: readonly T[], limit = RECENT_RUNS_LIMIT): T[] {
  return [...runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, limit);
}
