import type { SortKey } from "@/components/agent-performance";

/** Sortable columns in display order (AC-42, AC-47); `view` has no sort and is added by the table. */
export const COLUMNS: readonly { key: SortKey; label: "agent" | "runs" | "avgCost" | "avgDuration" | "acceptRate" | "lastRun"; sortLabel: "agent" | "runs" | "cost" | "duration" | "acceptRate" | "lastRun" }[] = [
  { key: "agent", label: "agent", sortLabel: "agent" },
  { key: "runs", label: "runs", sortLabel: "runs" },
  { key: "cost", label: "avgCost", sortLabel: "cost" },
  { key: "duration", label: "avgDuration", sortLabel: "duration" },
  { key: "accept", label: "acceptRate", sortLabel: "acceptRate" },
  { key: "lastRun", label: "lastRun", sortLabel: "lastRun" },
];

export const SEVERITIES = [
  { key: "CRITICAL", label: "critical" },
  { key: "WARNING", label: "warning" },
  { key: "SUGGESTION", label: "suggestion" },
] as const;
