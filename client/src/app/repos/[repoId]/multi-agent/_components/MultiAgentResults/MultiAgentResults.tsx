/* MultiAgentResults — /repos/:repoId/multi-agent/:id. Header, Columns/Tabs switch
   (?view=), disagreements block and the run-trace drawer host. */
"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { usePulls } from "@/lib/hooks/core";
import { useMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useActiveRepo } from "@/lib/repo-context";
import RunTraceDrawer from "../../../pulls/[number]/_components/RunTraceDrawer";
import { configureRunHref } from "../ConfigureRun/helpers";
import { AgentColumnCard } from "../AgentColumnCard";
import { AgentTabsView } from "../AgentTabsView";
import { DisagreementsBlock } from "../DisagreementsBlock";
import { VIEWS, type ResultsView } from "./constants";
import { alsoFlaggedBy, formatCost, formatDuration, parseView } from "./helpers";
import { columnsGrid, s } from "./styles";

interface TraceTarget {
  runId: string;
  running: boolean;
  agentName: string;
}

export function MultiAgentResults({ repoId, id }: { repoId: string; id: string }) {
  const t = useTranslations("multiAgent");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const { activeRepo } = useActiveRepo();
  const run = useMultiAgentRun(id);
  const pulls = usePulls(repoId);
  const [trace, setTrace] = React.useState<TraceTarget | null>(null);

  const setView = (next: ResultsView) => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.set("view", next);
    router.replace(`${pathname}?${sp.toString()}`);
  };

  if (run.isLoading) {
    return (
      <div style={s.skeleton} data-testid="results-skeleton">
        <Skeleton height={28} width={320} />
        <Skeleton height={220} />
      </div>
    );
  }

  if (run.isError || !run.data) {
    if (run.error instanceof ApiError && run.error.status === 404) {
      return (
        <EmptyState
          icon="Users"
          title={t("results.notFound")}
          body={
            <Link href={configureRunHref(repoId)} style={s.notFoundLink}>
              {t("results.configureRun")}
            </Link>
          }
        />
      );
    }
    return <ErrorState title={t("results.loadError")} onRetry={() => run.refetch()} />;
  }

  const data = run.data;
  const pr = pulls.data?.find((p) => p.id === data.pr_id);
  const prNumber = data.pr_number ?? pr?.number ?? null;
  const columns = data.columns;
  const flagged = alsoFlaggedBy(data.groups);
  const openTrace = (col: { run_id: string; agent_name: string }, running: boolean) =>
    setTrace({ runId: col.run_id, running, agentName: col.agent_name });
  const viewLabel: Record<ResultsView, string> = {
    columns: t("results.viewColumns"),
    tabs: t("results.viewTabs"),
  };

  return (
    <div>
      <div style={s.header}>
        <h1 style={s.title}>{t("results.title")}</h1>
        <span style={s.sub}>{t("results.agentsParallel", { count: data.agent_count })}</span>
        <div style={s.spacer}>
          <div style={s.switchWrap} role="group">
            {VIEWS.map((v) => (
              <Button key={v} size="sm" kind="tertiary" active={view === v} onClick={() => setView(v)}>
                {viewLabel[v]}
              </Button>
            ))}
          </div>
          <Link
            href={configureRunHref(repoId, {
              pr: prNumber,
              agents: columns.map((c) => c.agent_id).filter((x): x is string => !!x),
            })}
          >
            <Button size="sm" kind="secondary" icon="Settings">
              {t("results.configureRun")}
            </Button>
          </Link>
        </div>
      </div>

      <div style={s.meta}>
        {prNumber != null && <span className="mono" style={s.prNumber}>#{prNumber}</span>}
        {pr && <span style={s.prTitle}>{pr.title}</span>}
        <span style={s.totals} className="mono">
          <Icon.Cpu size={14} style={{ color: "var(--accent)", verticalAlign: "middle", marginRight: 6 }} />
          {formatDuration(data.total_duration_ms)} · {formatCost(data.total_cost_usd)}
        </span>
      </div>

      {columns.length === 0 ? (
        <EmptyState icon="Users" title={t("results.noColumns")} />
      ) : view === "tabs" ? (
        <AgentTabsView
          columns={columns}
          prId={data.pr_id}
          repoFullName={activeRepo?.full_name ?? null}
          headSha={pr?.head_sha ?? null}
          onOpenTrace={openTrace}
        />
      ) : (
        <div style={s.body}>
          <div style={columnsGrid(columns.length)}>
            {columns.map((c) => (
              <AgentColumnCard key={c.run_id} column={c} alsoFlagged={flagged} onOpenTrace={openTrace} />
            ))}
          </div>
          <DisagreementsBlock groups={data.groups} columns={columns} />
        </div>
      )}

      {trace && (
        <RunTraceDrawer
          runId={trace.runId}
          agentName={trace.agentName}
          prNumber={prNumber}
          running={trace.running}
          onClose={() => setTrace(null)}
        />
      )}
    </div>
  );
}
