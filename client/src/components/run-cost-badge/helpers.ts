/** $0.0123-style, 4 decimal places; "—" when cost is unknown (null/undefined). */
export function formatCost(costUsd: number | null | undefined): string {
  if (costUsd == null) return "—";
  return `$${costUsd.toFixed(4)}`;
}
