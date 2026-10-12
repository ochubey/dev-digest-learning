import React from "react";

export interface MetricBarProps {
  /** Value between 0 and 1; null renders an empty track and an em dash. */
  value: number | null;
  /** CSS color of the filled part. */
  color: string;
  /** Accessible name, e.g. "Recall". */
  label: string;
  width?: number;
}

/** Thin progress bar with the whole-percent value next to it (text, not color, carries the value). */
export function MetricBar({ value, color, label, width = 72 }: MetricBarProps) {
  const pct = value === null ? null : Math.round(value * 100);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }} data-testid="eval-metric-bar">
      <span
        role="img"
        aria-label={pct === null ? `${label}: no value` : `${label}: ${pct}%`}
        style={{ width, height: 6, borderRadius: 3, background: "var(--bg-hover)", overflow: "hidden", display: "inline-block" }}
      >
        <span style={{ display: "block", height: "100%", width: `${Math.min(100, Math.max(0, pct ?? 0))}%`, background: color, borderRadius: 3 }} />
      </span>
      <span className="mono tnum" style={{ fontSize: 12, minWidth: 34, textAlign: "right" }}>
        {pct === null ? "—" : `${pct}%`}
      </span>
    </span>
  );
}
