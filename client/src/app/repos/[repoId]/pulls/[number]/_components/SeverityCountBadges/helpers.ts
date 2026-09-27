import type { FindingRecord, Severity } from "@devdigest/shared";

/** Fixed display order — matches FindingsPanel's SEVERITY_ORDER (CRITICAL first). */
export const SEVERITY_DISPLAY_ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** Tally findings by severity. Only the 3 real Severity values are counted. */
export function countBySeverity(findings: FindingRecord[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if (f.severity in counts) counts[f.severity as Severity]++;
  }
  return counts;
}
