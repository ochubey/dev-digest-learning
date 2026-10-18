import { EM_DASH } from "./constants";
import type { Period } from "./period";

export { EM_DASH };

/** USD estimate: two decimals from one cent, four below it, never "$0.00" for a positive amount. */
export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return EM_DASH;
  if (n === 0) return "$0.00";
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  if (n < 0.0001) return "<$0.0001";
  return `$${n.toFixed(4)}`;
}

/** "14.2 s" under a minute, "1 m 05 s" from a minute. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return EM_DASH;
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} m ${String(total % 60).padStart(2, "0")} s`;
}

export function formatRate(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return EM_DASH;
  return `${Math.round(rate * 100)}%`;
}

export function formatShare(share: number): string {
  if (share > 0 && share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}

/** UTC instant as "2026-10-18 09:30 UTC". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export function formatPeriod(p: Period): string {
  return `${formatDateTime(p.from)} – ${formatDateTime(p.to)}`;
}
