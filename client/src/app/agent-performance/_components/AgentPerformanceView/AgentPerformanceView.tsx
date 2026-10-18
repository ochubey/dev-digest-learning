"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import {
  PeriodPicker,
  formatPeriod,
  parsePeriodParams,
  toSearchParams,
  type AgentPerformance,
  type Period,
  type PeriodSelection,
} from "@/components/agent-performance";
import { useAgentPerformance } from "@/lib/hooks/agent-performance";
import { AgentTable } from "./_components/AgentTable";
import { CostBreakdown } from "./_components/CostBreakdown";
import { EmptyState } from "./_components/EmptyState";
import { SummaryCards } from "./_components/SummaryCards";
import { s } from "./styles";

/**
 * Agent Performance dashboard (SPEC-06). Read-only: one GET /agent-performance for the period in
 * the URL (`?range=1d|30d|custom&start&end`). A preset's "now" is read once, when it is selected or
 * the page loads, and kept in state so re-renders never change the query key.
 */
export function AgentPerformanceView() {
  const t = useTranslations("agentPerformance");
  const router = useRouter();
  const search = useSearchParams();
  const key = search?.toString() ?? "";
  const [state, setState] = React.useState(() => parsePeriodParams(new URLSearchParams(key), new Date()));
  const known = React.useRef(key);

  // Browser back/forward or a pasted link: re-read the URL; our own writes are already in state.
  React.useEffect(() => {
    if (key === known.current) return;
    known.current = key;
    setState(parsePeriodParams(new URLSearchParams(key), new Date()));
  }, [key]);

  const apply = (selection: PeriodSelection, period: Period) => {
    const next = toSearchParams(selection).toString();
    known.current = next;
    setState({ selection, period });
    router.replace(`/agent-performance?${next}`);
  };

  const q = useAgentPerformance(state.period);

  return (
    <div style={s.page}>
      <div>
        <h1 style={s.h1}>{t("title")}</h1>
        <p style={s.subtitle}>{t("subtitle")}</p>
      </div>
      <PeriodPicker value={state.selection} onApply={apply} />
      {q.isError ? (
        <ErrorState title={t("loadError")} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <DashboardSkeleton />
      ) : (
        <Loaded data={q.data} />
      )}
    </div>
  );
}

function Loaded({ data }: { data: AgentPerformance }) {
  const t = useTranslations("agentPerformance");
  const { totals } = data;
  const periodText = t("period.applied", { range: formatPeriod(data.period) });

  if (totals.runs === 0) {
    return <EmptyState hasAgents={data.agents.length > 0} periodText={periodText} excluded={totals.runs_excluded} />;
  }
  return (
    <>
      <div style={s.scope}>
        <p style={s.scopeLine}>{periodText}</p>
        <p style={s.scopeLine}>{t("scope.counted", { count: totals.runs })}</p>
        {totals.runs_excluded > 0 && <p style={s.scopeLine}>{t("scope.excluded", { count: totals.runs_excluded })}</p>}
      </div>
      <SummaryCards totals={totals} mostActive={data.most_active} />
      <AgentTable agents={data.agents} period={data.period} />
      <CostBreakdown costByAgent={data.cost_by_agent} costByModel={data.cost_by_model} total={totals.total_cost_usd} />
    </>
  );
}

/** Bars only, in the shape of the page (cards, table, breakdowns); never a number (AC-60). */
function DashboardSkeleton() {
  const t = useTranslations("agentPerformance");
  return (
    <div role="status" aria-busy="true" aria-label={t("loading")} style={s.skeleton}>
      <div style={s.skeletonCards}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={84} />
        ))}
      </div>
      <div style={s.skeletonRows}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} height={i === 0 ? 20 : 34} />
        ))}
      </div>
      <div style={s.skeletonPair}>
        <Skeleton height={120} />
        <Skeleton height={120} />
      </div>
    </div>
  );
}
