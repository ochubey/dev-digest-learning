import type { IconName } from "@devdigest/ui";
import type { RiskSeverity } from "@devdigest/shared";

/** Icon per model-emitted risk kind. Anything else renders GENERIC_RISK_ICON (AC-80). */
export const RISK_KIND_ICON: Record<string, IconName> = {
  security: "Shield",
  db_migration: "Database",
  breaking_api: "AlertOctagon",
  perf: "Gauge",
  deps: "Boxes",
  correctness: "Bug",
  other: "AlertTriangle",
};

export const GENERIC_RISK_ICON: IconName = "AlertTriangle";

/** Kinds that have a `riskKind.<kind>` message. */
export const KNOWN_RISK_KINDS = Object.keys(RISK_KIND_ICON);

export const SEVERITY_COLOR: Record<RiskSeverity, string> = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--text-muted)",
};

/** Server keeps at most this many callers in a brief's blast snapshot (MAX_BLAST_CALLERS, all
 *  symbols together), while the live /blast is only capped per symbol. A snapshot at the cap is
 *  therefore a truncated view of the live callers. */
export const MAX_BLAST_CALLERS = 25;

/** Separator between input and output token counts in the cost-and-tokens line (a symbol, not text). */
export const TOKENS_ARROW = "→";
