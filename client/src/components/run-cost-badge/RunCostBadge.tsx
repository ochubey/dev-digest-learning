/* RunCostBadge — display-only USD cost badge for a review run. Costs are
   computed server-side (price book × tokens) at run time and persisted; this
   component only formats the already-fetched number. Renders "—" when null
   (no completed run yet, or an unpriced model). */
import { formatCost } from "./helpers";

export function RunCostBadge({ costUsd }: { costUsd: number | null | undefined }) {
  return (
    <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>
      {formatCost(costUsd)}
    </span>
  );
}
