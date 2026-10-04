"use client";

import React, { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@devdigest/shared";
import { GRAPH } from "./constants";
import { layoutGraph, truncate, type GraphNodeKind } from "./graph";
import { splitSymbols } from "./helpers";
import { s } from "./styles";

const STROKE: Record<GraphNodeKind, string> = {
  symbol: "var(--accent)",
  caller: "var(--border)",
  endpoint: "var(--accent)",
  cron: "var(--warn)",
};

/** Changed symbols -> callers -> endpoints/crons, as an inline SVG (no graph library). */
export function BlastGraph({ downstream }: { downstream: DownstreamImpact[] }) {
  const t = useTranslations("blast");
  // Symbols arrive ordered by importance; a PR with dozens would draw a hundreds-of-nodes
  // column, so draw the top few and point to the tree for the rest.
  const { shown, total } = useMemo(() => {
    const { active } = splitSymbols(downstream);
    return { shown: active.slice(0, GRAPH.maxSymbols), total: active.length };
  }, [downstream]);
  const layout = useMemo(() => layoutGraph(shown), [shown]);

  if (!layout) return <div style={s.muted}>{t("graph.empty")}</div>;

  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const half = GRAPH.nodeH / 2;

  return (
    <div>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={s.graphSvg}
      >
        {layout.edges.map((e) => {
          const a = byId.get(e.from)!;
          const b = byId.get(e.to)!;
          const x1 = a.x + GRAPH.nodeW;
          const y1 = a.y + half;
          const x2 = b.x;
          const y2 = b.y + half;
          const dx = (x2 - x1) / 2;
          return (
            <path
              key={`${e.from}>${e.to}`}
              data-testid="blast-edge"
              d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1.2}
            />
          );
        })}
        {layout.nodes.map((n) => (
          <g key={n.id} data-testid={`blast-node-${n.kind}`}>
            <title>{n.label}</title>
            <rect
              x={n.x}
              y={n.y}
              width={GRAPH.nodeW}
              height={GRAPH.nodeH}
              rx={6}
              fill="var(--bg-hover)"
              stroke={STROKE[n.kind]}
              strokeWidth={n.kind === "caller" ? 1 : 1.5}
            />
            <text
              x={n.x + GRAPH.nodeW / 2}
              y={n.y + half}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={12}
              fontFamily="var(--font-mono, monospace)"
              fill="var(--text-primary)"
            >
              {truncate(n.label)}
            </text>
          </g>
        ))}
      </svg>
      {total > shown.length && (
        <div style={s.graphNote}>{t("graph.truncated", { shown: shown.length, total })}</div>
      )}
      <div style={s.legend}>
        {(["symbol", "callers", "endpoints"] as const).map((k) => (
          <span key={k} style={s.legendItem}>
            <span
              style={{
                ...s.legendDot,
                borderColor: k === "callers" ? "var(--border)" : "var(--accent)",
              }}
            />
            {t(`graph.legend.${k}`)}
          </span>
        ))}
      </div>
    </div>
  );
}
