/* Smart Diff findings support for the DiffViewer: the API shape the viewer needs
   plus pure helpers that anchor findings to rendered lines (same `SIDE:line` keys
   as human comment threads, see comments.ts). */
import type { CSSProperties } from "react";
import type { Severity } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { lineKey } from "./comments";

/** Findings to show in the diff + whether their inline cards are visible. */
export interface DiffFindingsApi {
  /** Already filtered to the visible ones (see lib/latest-findings.ts): never `out`; `signal` included. */
  items: FindingRecord[];
  /** Hides inline cards and the unmatched block only; dots always stay. */
  show: boolean;
  prId: string | null;
}

/** Display bucket for a severity; unknown values fall back to `suggestion`. */
export type FindingLabel = "blocker" | "warning" | "suggestion";

export function severityLabel(severity: string): FindingLabel {
  if (severity === "CRITICAL") return "blocker";
  if (severity === "WARNING") return "warning";
  return "suggestion";
}

/** Severity bucket for colour/icon: CRITICAL, WARNING or SUGGESTION. Anything else
   (e.g. INFO) falls back to SUGGESTION, consistently with `severityLabel`. */
export function knownSeverity(severity: string): Severity {
  return severity === "CRITICAL" || severity === "WARNING" ? severity : "SUGGESTION";
}

const RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

/** Highest severity among findings (unknown ones count as SUGGESTION), or null. */
export function topSeverity(findings: readonly FindingRecord[]): Severity | null {
  let best: Severity | null = null;
  for (const f of findings) {
    const sev = RANK[f.severity] ? (f.severity as Severity) : "SUGGESTION";
    if (best === null || RANK[sev]! > RANK[best]!) best = sev;
  }
  return best;
}

/** Findings of one file. */
export function findingsForFile(
  items: readonly FindingRecord[] | undefined,
  path: string,
): FindingRecord[] {
  return (items ?? []).filter((f) => f.file === path);
}

/**
 * Split a file's findings into ones anchored to a rendered line (key
 * `RIGHT:${start_line}`) and the rest (line outside the patch / no patch).
 */
export function partitionFindings(
  findings: readonly FindingRecord[],
  renderedKeys: Set<string>,
): { matched: Map<string, FindingRecord[]>; unmatched: FindingRecord[] } {
  const matched = new Map<string, FindingRecord[]>();
  const unmatched: FindingRecord[] = [];
  for (const f of findings) {
    const key = lineKey("RIGHT", f.start_line);
    if (key && renderedKeys.has(key)) {
      const list = matched.get(key) ?? [];
      list.push(f);
      matched.set(key, list);
    } else {
      unmatched.push(f);
    }
  }
  return { matched, unmatched };
}

export const fs = {
  /** Same rail as comment threads, so cards align under the code. */
  card: (color: string, muted: boolean): CSSProperties => ({
    margin: "6px 14px 8px 58px",
    padding: "10px 12px 10px 14px",
    border: "1px solid var(--border)",
    borderLeftWidth: 4,
    borderLeftColor: color,
    borderRadius: 6,
    background: "var(--bg-elevated)",
    opacity: muted ? 0.65 : 1,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  }),
  head: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  title: (dismissed: boolean): CSSProperties => ({
    fontWeight: 600,
    fontSize: 13,
    color: "var(--text-primary)",
    textDecoration: dismissed ? "line-through" : "none",
  }),
  label: (color: string): CSSProperties => ({
    marginLeft: "auto",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color,
  }),
  tag: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  signalTag: { fontSize: 11, fontWeight: 700, color: "var(--warn)" } satisfies CSSProperties,
  scopeReason: {
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  prose: {
    fontSize: 13,
    lineHeight: "19px",
    color: "var(--text-secondary)",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  actions: { display: "flex", gap: 8, alignItems: "center" } satisfies CSSProperties,
  unmatchedWrap: {
    borderTop: "1px solid var(--border)",
    marginTop: 4,
    paddingTop: 10,
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  unmatchedTitle: {
    margin: "0 14px 0 58px",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  /** Header dot on a file card: a filled circle, no number. */
  dot: (color: string): CSSProperties => ({
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
    flexShrink: 0,
  }),
} as const;
