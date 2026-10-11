import type { EvalSuiteRun } from "@devdigest/shared";

/** "X/Y" parts for the Cases passed card; passed is null when the run has no counts. */
export function passedParts(run: Pick<EvalSuiteRun, "counts" | "cases_total">): { passed: number | null; total: number } {
  return { passed: run.counts?.cases_passed ?? null, total: run.cases_total };
}
