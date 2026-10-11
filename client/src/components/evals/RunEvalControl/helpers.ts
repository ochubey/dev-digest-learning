import type { EvalRunPage, EvalSuiteRun } from "@devdigest/shared";

/** The first `running` run across the loaded pages (newest first), or null. */
export function findRunning(pages: EvalRunPage[] | undefined): EvalSuiteRun | null {
  for (const p of pages ?? []) {
    const r = p.items.find((i) => i.status === "running");
    if (r) return r;
  }
  return null;
}
