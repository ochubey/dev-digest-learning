/** Pure helpers for RunReviewDropdown. */
import type { AgentRunEstimate } from "@devdigest/shared";

/** Short per-agent estimate like "~6s"; null without history. */
export function pickEstimateLabel(est: AgentRunEstimate | undefined): string | null {
  if (!est || est.sample_size <= 0 || est.avg_duration_ms == null) return null;
  return `~${Math.max(1, Math.round(est.avg_duration_ms / 1000))}s`;
}
