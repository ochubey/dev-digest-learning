import type { FindingRecord, Severity } from "@devdigest/shared";
import { isVisibleScope } from "@/lib/latest-findings";
import { LOW_CONFIDENCE_THRESHOLD, SEVERITY_ORDER } from "./constants";

/** Out-of-scope findings are dropped unless `showOut`. Optionally drop low-confidence findings, optionally restrict to one
 *  severity (AND'd with the confidence filter), and sort by severity. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severityFilter: Severity | null = null,
  showOut = false,
): FindingRecord[] {
  let shown = showOut ? findings : findings.filter((f) => isVisibleScope(f.scope));
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (severityFilter) shown = shown.filter((f) => f.severity === severityFilter);
  return [...shown].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
