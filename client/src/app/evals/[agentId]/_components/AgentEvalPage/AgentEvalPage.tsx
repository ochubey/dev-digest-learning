"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, ErrorState, Skeleton } from "@devdigest/ui";
import type { EvalSuiteRun } from "@devdigest/shared";
import { MetricStrip, RunDetailDrawer, RunEvalControl, ScoringNote, latestFinished, previousFinished } from "@/components/evals";
import { useAgentEvalCases, useAgentEvalRuns, useEvalOverview } from "@/lib/hooks/evals";
import { COMPARE_SELECTION_SIZE, EVAL_TEST_IDS } from "../../../constants";
import { toggleSelection } from "../../../helpers";
import { CompareRunsDialog } from "./_components/CompareRunsDialog";
import { RunsTable } from "./_components/RunsTable";
import { s } from "./styles";

export interface AgentEvalPageProps {
  agentId: string;
}

/** /evals/[agentId] (AC-61..AC-66): one agent's metrics, runs, run detail and compare. */
export function AgentEvalPage({ agentId }: AgentEvalPageProps) {
  const t = useTranslations("evalsDashboard");
  const router = useRouter();
  const overview = useEvalOverview();
  const runs = useAgentEvalRuns(agentId);
  const cases = useAgentEvalCases(agentId);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [opened, setOpened] = React.useState<EvalSuiteRun | null>(null);
  const [comparing, setComparing] = React.useState(false);
  // The page is keyed by agent id, so a different agent starts with a clean selection.
  // Remember the clicked button: some browsers (Safari) do not focus a button on click.
  const compareRef = React.useRef<HTMLElement | null>(null);

  const loaded = React.useMemo(() => runs.data?.pages.flatMap((pg) => pg.items) ?? [], [runs.data]);

  if (overview.isLoading) {
    return (
      <div style={s.page} role="status" aria-label={t("agent.loading")}>
        <div style={s.skeletons}>
          <Skeleton height={26} width={260} />
          <Skeleton height={70} />
          <Skeleton height={160} />
        </div>
      </div>
    );
  }
  if (overview.isError || !overview.data) {
    return (
      <ErrorState fullScreen title={t("agent.errorTitle")} body={t("agent.errorBody")} onRetry={() => void overview.refetch()} />
    );
  }

  const entry = overview.data.agents.find((a) => a.agent_id === agentId);
  if (!entry) {
    return (
      <ErrorState fullScreen title={t("agent.notFoundTitle")} body={t("agent.notFoundBody")} />
    );
  }

  const items = loaded;
  // Derived from the runs list so a failed newest run never becomes "latest"; the overview
  // entry is only the fallback while the runs query has no data yet.
  const finishedOnly = (r: EvalSuiteRun | null | undefined) => (r && latestFinished([r]) ? r : null);
  const latest = runs.data ? latestFinished(items) : finishedOnly(entry.latest);
  const previous = runs.data ? previousFinished(items) : finishedOnly(entry.previous);
  const pair = selected
    .map((id) => items.find((r) => r.id === id))
    .filter((r): r is EvalSuiteRun => !!r);
  const canCompare = pair.length === COMPARE_SELECTION_SIZE;

  return (
    <div style={s.page}>
      <div style={s.top}>
        <div style={s.grow}>
          <h1 style={s.title}>{entry.name}</h1>
          <p style={s.meta}>
            {t("agent.model", { model: entry.model })} · {t("agent.version", { version: entry.version })}
          </p>
        </div>
        <label style={s.hint}>
          <span style={{ marginRight: 6 }}>{t("agent.switcherLabel")}</span>
          <select
            style={s.select}
            value={agentId}
            aria-label={t("agent.switcherLabel")}
            onChange={(e) => router.push(`/evals/${e.target.value}`)}
          >
            {overview.data.agents.map((a) => (
              <option key={a.agent_id} value={a.agent_id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" icon="ChevronLeft" onClick={() => router.push("/evals")}>
          {t("agent.allAgents")}
        </Button>
      </div>

      <MetricStrip latest={latest} previous={previous} agentVersion={entry.version} />
      <ScoringNote />
      <RunEvalControl
        agentId={agentId}
        caseCount={cases.data?.length ?? 0}
        model={entry.model}
        disabled={cases.isLoading}
      />

      <section style={s.section} aria-labelledby="eval-runs-heading">
        <h2 id="eval-runs-heading" style={s.h2}>
          {t("agent.runsHeading")}
        </h2>
        <div style={s.toolbar}>
          <Button
            size="sm"
            data-testid={EVAL_TEST_IDS.compareButton}
            disabled={!canCompare}
            aria-describedby={canCompare ? undefined : "eval-compare-hint"}
            onClick={(e) => {
              compareRef.current = e.currentTarget;
              setComparing(true);
            }}
          >
            {t("agent.compare")}
          </Button>
          {!canCompare && (
            <span id="eval-compare-hint" style={s.hint}>
              {t("agent.compareHint")}
            </span>
          )}
        </div>
        {runs.isLoading ? (
          <div style={s.skeletons} role="status" aria-label={t("agent.loading")}>
            <Skeleton height={36} />
            <Skeleton height={36} />
          </div>
        ) : runs.isError ? (
          <p role="alert" style={s.error}>
            {t("agent.runsError")}
          </p>
        ) : items.length === 0 ? (
          <p style={s.muted}>{t("agent.noRuns")}</p>
        ) : (
          <RunsTable
            runs={items}
            selected={selected}
            onToggle={(id) => setSelected((cur) => toggleSelection(cur, id, COMPARE_SELECTION_SIZE))}
            onOpen={setOpened}
            hasMore={!!runs.hasNextPage}
            loadingMore={runs.isFetchingNextPage}
            onLoadMore={() => void runs.fetchNextPage()}
          />
        )}
      </section>

      {opened && <RunDetailDrawer run={opened} onClose={() => setOpened(null)} />}
      {comparing && canCompare && (
        <CompareRunsDialog runs={[pair[0]!, pair[1]!]} onClose={() => setComparing(false)} returnFocusRef={compareRef} />
      )}
    </div>
  );
}
