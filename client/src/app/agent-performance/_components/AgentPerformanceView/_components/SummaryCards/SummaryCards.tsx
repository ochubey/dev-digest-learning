"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import { EM_DASH, EstimateLabel, formatRate, formatUsd, type AgentPerformanceTotals, type MostActive } from "@/components/agent-performance";
import { s } from "./styles";

/** Total runs, Total cost, Avg accept rate, Most-active agent (AC-38..AC-41). */
export function SummaryCards({ totals, mostActive }: { totals: AgentPerformanceTotals; mostActive: MostActive | null }) {
  const t = useTranslations("agentPerformance");
  const noRate = totals.decisions === 0 || totals.accept_rate === null;
  return (
    <div style={s.grid}>
      <article style={s.card}>
        <h3 style={s.label}>{t("summary.totalRuns")}</h3>
        <div style={s.value}>{totals.runs}</div>
      </article>

      <article style={s.card}>
        <h3 style={s.label}>{t("summary.totalCost")}</h3>
        <div>
          <EstimateLabel />
        </div>
        <div style={s.value}>{totals.total_cost_usd === null ? <span style={s.valueSmall}>{t("cost.noneRecorded")}</span> : formatUsd(totals.total_cost_usd)}</div>
        {totals.runs_without_cost > 0 && <div style={s.sub}>{t("summary.withoutCost", { count: totals.runs_without_cost })}</div>}
      </article>

      <article style={s.card}>
        <h3 style={s.label}>{t("summary.avgAcceptRate")}</h3>
        {noRate ? (
          <div style={s.sub}>{t("rate.na")}</div>
        ) : (
          <>
            <div style={s.value}>{formatRate(totals.accept_rate)}</div>
            <div style={s.sub}>
              <span>{t("summary.decisionsOf", { accepted: totals.accepted, decisions: totals.decisions })}</span>
              {totals.low_sample && <Badge color="var(--text-muted)">{t("rate.lowSample")}</Badge>}
            </div>
          </>
        )}
      </article>

      <article style={s.card}>
        <h3 style={s.label}>{t("summary.mostActive")}</h3>
        {mostActive ? (
          <>
            <div style={s.value} title={mostActive.agent_name}>
              {mostActive.agent_name}
            </div>
            <div style={s.sub}>{t("summary.runCount", { count: mostActive.runs })}</div>
          </>
        ) : (
          <div style={s.value}>{EM_DASH}</div>
        )}
      </article>
    </div>
  );
}
