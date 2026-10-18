"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState } from "@devdigest/ui";
import type { Agent, AgentStats } from "@devdigest/shared";
import {
  AcceptRate,
  EstimateLabel,
  LastRun,
  MetricSkeleton,
  PeriodPicker,
  formatDuration,
  formatPeriod,
  formatUsd,
  parseWindow,
  presetPeriod,
  selectionForWindow,
  type Period,
  type PeriodSelection,
} from "@/components/agent-performance";
import { useAgentStats } from "@/lib/hooks/agent-performance";
import { s } from "./styles";

/**
 * Stats tab (SPEC-06 G6): the same aggregation the dashboard row shows, for one
 * agent. The window comes from `?from=&to=` (exact instants) or is the last 30
 * days, read once when the tab opens. Read-only: GET /agents/:id/stats only.
 */
export function StatsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("runs.stats");
  const router = useRouter();
  const search = useSearchParams();
  const fromUrl = parseWindow(search?.get("from"), search?.get("to"));
  const fallback = React.useRef<Period | null>(null);
  if (fromUrl === null && fallback.current === null) fallback.current = presetPeriod("30d", new Date());
  const period = fromUrl ?? (fallback.current as Period);
  const selection: PeriodSelection = fromUrl ? selectionForWindow(fromUrl) : { range: "30d" };

  const apply = (_sel: PeriodSelection, next: Period) => {
    const sp = new URLSearchParams(search?.toString() ?? "");
    sp.set("tab", "stats");
    sp.set("from", next.from);
    sp.set("to", next.to);
    fallback.current = null;
    router.replace(`/agents/${agent.id}?${sp.toString()}`);
  };

  const q = useAgentStats(agent.id, period);

  return (
    <div style={s.wrap} data-testid="agent-stats-tab">
      <PeriodPicker value={selection} onApply={apply} />
      <p style={s.applied}>{t("appliedPeriod", { range: formatPeriod(q.data ? { from: q.data.period_from, to: q.data.period_to } : period) })}</p>
      {q.isError ? (
        <ErrorState title={t("loadError")} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <MetricSkeleton count={6} />
      ) : (
        <Body stats={q.data} />
      )}
    </div>
  );
}

function Body({ stats }: { stats: AgentStats }) {
  const t = useTranslations("runs.stats");
  const notes = (
    <ul style={s.notes}>
      {stats.runs > 0 && <li>{t("countedRuns", { count: stats.runs })}</li>}
      {stats.runs_excluded > 0 && <li>{t("excludedRuns", { count: stats.runs_excluded })}</li>}
      {stats.runs > 0 && stats.runs_without_cost > 0 && <li>{t("runsWithoutCost", { count: stats.runs_without_cost })}</li>}
    </ul>
  );

  if (stats.runs === 0) {
    return (
      <>
        <div style={s.empty}>
          <h3 style={s.emptyTitle}>{t("noRunsInPeriod")}</h3>
          <p style={s.emptyBody}>{t("noRunsHint")}</p>
          <div>
            <LastRun lastRunAt={stats.last_run_at} allTime={stats.last_run_at_all_time} />
          </div>
        </div>
        {notes}
      </>
    );
  }

  return (
    <>
      <dl style={s.grid}>
        <Metric label={t("metric.runs")}>{stats.runs}</Metric>
        <Metric label={t("metric.totalCost")} estimate>
          {stats.total_cost_usd === null ? t("noCost") : formatUsd(stats.total_cost_usd)}
        </Metric>
        <Metric label={t("metric.avgCostPerRun")} estimate>
          {formatUsd(stats.avg_cost_usd)}
        </Metric>
        <Metric label={t("avgDuration")}>{formatDuration(stats.avg_latency_ms)}</Metric>
        <Metric label={t("metric.acceptRate")}>
          <AcceptRate rate={stats.accept_rate} accepted={stats.accepted} decisions={stats.decisions} />
        </Metric>
        <Metric label={t("findingOutcomes")}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {t("decisionCounts", { accepted: stats.accepted, dismissed: stats.dismissed, pending: stats.pending })}
          </span>
        </Metric>
        <Metric label={t("lastRun")}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            <LastRun lastRunAt={stats.last_run_at} allTime={stats.last_run_at_all_time} />
          </span>
        </Metric>
      </dl>
      {notes}
    </>
  );
}

function Metric({ label, estimate, children }: { label: string; estimate?: boolean; children: React.ReactNode }) {
  return (
    <div style={s.metric}>
      <dt style={s.label}>
        {label}
        {estimate && <EstimateLabel />}
      </dt>
      <dd style={s.value}>{children}</dd>
    </div>
  );
}
