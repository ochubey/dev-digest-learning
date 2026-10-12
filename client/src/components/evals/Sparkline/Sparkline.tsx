import React from "react";

export interface SparklineProps {
  /** Values in chronological order (oldest first), each between 0 and 1. */
  values: ReadonlyArray<number | null>;
  /** CSS color of the line; defaults to the accent token. */
  color?: string;
  width?: number;
  height?: number;
  /** Accessible description, e.g. "Recall trend over 5 runs". Omit for a decorative sparkline. */
  label?: string;
}

/** Tiny inline trend line. Null values are skipped; fewer than two points renders nothing. */
export function Sparkline({ values, color = "var(--accent)", width = 84, height = 28, label }: SparklineProps) {
  const points = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => typeof p.v === "number");
  if (points.length < 2) return null;

  const pad = 3;
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const span = max - min || 1;
  const lastIndex = values.length - 1 || 1;
  const x = (i: number) => pad + (i / lastIndex) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const last = points[points.length - 1]!;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-testid="eval-sparkline"
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")}
      />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.2} fill={color} />
    </svg>
  );
}
