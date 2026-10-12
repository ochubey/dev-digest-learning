"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalSuiteRun } from "@devdigest/shared";
import { formatPct } from "../helpers";
import { TREND_SERIES, finishedChronological, gridlines, labelIndexes, yRange } from "./helpers";
import { s } from "./styles";

export interface TrendChartProps {
  /** Runs in any order; only finished runs are plotted, oldest first. */
  runs: readonly EvalSuiteRun[];
  width?: number;
  height?: number;
}

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const PAD = { top: 10, right: 16, bottom: 28, left: 40 };

/** Inline SVG line chart: Recall, Precision and Citation per finished run (x = run order). */
export function TrendChart({ runs, width = 720, height = 220 }: TrendChartProps) {
  const t = useTranslations("evalsAgentPage");
  const finished = React.useMemo(() => finishedChronological(runs), [runs]);

  if (finished.length < 2) {
    return (
      <p style={s.muted} data-testid="eval-trend-empty">
        {finished.length === 0 ? t("trend.empty") : t("trend.onePoint")}
      </p>
    );
  }

  const all = finished.flatMap((r) => TREND_SERIES.map((x) => r.metrics[x.key])).filter((v): v is number => v != null);
  const { lo, hi } = yRange(all);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (finished.length - 1)) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * innerH;
  const showLabel = labelIndexes(finished.length);

  const summary = t("trend.summary", {
    count: finished.length,
    series: TREND_SERIES.map((x) => {
      const vals = finished.map((r) => r.metrics[x.key]).filter((v): v is number => v != null);
      return t("trend.seriesSummary", {
        metric: t(`metricName.${x.name}`),
        first: formatPct(vals[0]),
        last: formatPct(vals[vals.length - 1]),
      });
    }).join(" "),
  });

  return (
    <div style={s.wrap}>
      <ul style={s.legend} aria-label={t("trend.legend")}>
        {TREND_SERIES.map((x) => (
          <li key={x.key} style={s.legendItem}>
            <svg width={16} height={4} aria-hidden="true">
              <rect width={16} height={4} rx={2} fill={x.color} />
            </svg>
            {t(`metricName.${x.name}`)}
          </li>
        ))}
      </ul>
      <svg viewBox={`0 0 ${width} ${height}`} style={s.svg} role="img" aria-label={summary} data-testid="eval-trend-chart">
        {gridlines(lo, hi).map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(g)} y2={y(g)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(g)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="var(--text-muted)">
              {`${Math.round(g * 100)}%`}
            </text>
          </g>
        ))}
        {finished.map((r, i) =>
          showLabel.has(i) ? (
            <text key={r.id} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
              {`v${r.agent_version}`}
            </text>
          ) : null,
        )}
        {TREND_SERIES.map((series) => {
          // A null metric breaks the line instead of being drawn as zero.
          const segments: string[][] = [[]];
          finished.forEach((r, i) => {
            const v = r.metrics[series.key];
            if (v == null) segments.push([]);
            else segments[segments.length - 1]!.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
          });
          return (
            <g key={series.key} data-series={series.name}>
              {segments
                .filter((seg) => seg.length > 1)
                .map((seg, k) => (
                  <polyline key={k} points={seg.join(" ")} fill="none" stroke={series.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                ))}
              {finished.map((r, i) => {
                const v = r.metrics[series.key];
                if (v == null) return null;
                return (
                  <circle key={r.id} cx={x(i)} cy={y(v)} r={3.5} fill={series.color} data-testid="eval-trend-point">
                    <title>
                      {t("trend.point", {
                        metric: t(`metricName.${series.name}`),
                        version: r.agent_version,
                        date: DATE.format(new Date(r.started_at)),
                        value: formatPct(v),
                      })}
                    </title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
