"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import type { EvalOverview as Overview, EvalSuiteRun } from "@devdigest/shared";
import { MetricBar, ScoringNote, Sparkline, formatPct, shortModel } from "@/components/evals";
import { useAgentEvalRuns, useEvalOverview } from "@/lib/hooks/evals";
import { EVAL_TEST_IDS } from "../../constants";
import { formatRanAt, passedParts } from "../../helpers";
import { recallTrend, recentRuns } from "./helpers";
import { s } from "./styles";

type TFn = ReturnType<typeof useTranslations>;
type AgentSummary = Overview["agents"][number];

const COLORS = { recall: "var(--accent)", precision: "var(--ok)", citation: "var(--warn)" } as const;

function passText(t: TFn, run: EvalSuiteRun): string {
  const { passed, total } = passedParts(run);
  return t("passValue", { passed: passed ?? t("noValue"), total });
}

/** /evals landing (AC-59, AC-60, AC-64): every agent's latest eval numbers and the latest runs. */
export function EvalOverview() {
  const t = useTranslations("evalsOverview");
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useEvalOverview();

  if (isLoading) {
    return (
      <div style={s.page} role="status" aria-label={t("loading")}>
        <div style={s.skeletons}>
          <Skeleton height={26} width={240} />
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return <ErrorState fullScreen title={t("errorTitle")} body={t("errorBody")} onRetry={() => void refetch()} />;
  }

  const open = (id: string) => router.push(`/evals/${id}`);
  return (
    <div style={s.page}>
      <div>
        <h1 style={s.h1}>{t("title")}</h1>
        <p style={s.subtitle}>{t("subtitle")}</p>
      </div>
      <ScoringNote />
      {data.agents.length === 0 ? (
        <div style={s.empty}>
          <strong>{t("emptyTitle")}</strong>
          <span style={s.muted}>{t("emptyBody")}</span>
          <Link href="/agents" style={s.emptyLink}>
            {t("emptyCta")}
          </Link>
        </div>
      ) : (
        <>
          <AgentCards t={t} agents={data.agents} onOpen={open} />
          <RecentRuns t={t} data={data} onOpen={open} />
        </>
      )}
    </div>
  );
}

function AgentCards({ t, agents, onOpen }: { t: TFn; agents: Overview["agents"]; onOpen: (agentId: string) => void }) {
  return (
    <section style={s.section} aria-labelledby="eval-agents-heading">
      <h2 id="eval-agents-heading" style={s.h2}>
        {t("agentsHeading")}
      </h2>
      <div style={s.cards}>
        {agents.map((a) => (
          <AgentCard key={a.agent_id} t={t} agent={a} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function AgentCard({ t, agent: a, onOpen }: { t: TFn; agent: AgentSummary; onOpen: (agentId: string) => void }) {
  const latest = a.latest;
  const m = latest?.metrics;
  return (
    <div data-testid={EVAL_TEST_IDS.agentRow} style={s.card} onClick={() => onOpen(a.agent_id)}>
      <div style={s.cardMain}>
        <div style={s.nameLine}>
          <button type="button" style={s.nameBtn} aria-label={t("openAgent", { name: a.name })}>
            {a.name}
          </button>
          <span style={s.chip}>{a.model}</span>
        </div>
        <div style={s.muted}>
          {latest
            ? t("lastRun", {
                version: t("version", { version: latest.agent_version }),
                date: formatRanAt(latest.started_at),
                pass: passText(t, latest),
              })
            : t("noRuns")}
        </div>
      </div>
      {latest && m ? (
        <>
          <RecallSparkline t={t} agentId={a.agent_id} />
          <div style={s.metrics}>
            <Big label={t("shortRecall")} value={m.recall} color={COLORS.recall} />
            <Big label={t("shortPrecision")} value={m.precision} color={COLORS.precision} />
            <Big label={t("shortCitation")} value={m.citation_accuracy} color={COLORS.citation} />
          </div>
        </>
      ) : null}
      <span style={s.chevron} aria-hidden="true">
        ›
      </span>
    </div>
  );
}

function Big({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div style={s.metric}>
      <span className="tnum" style={{ ...s.big, color }}>
        {formatPct(value)}
      </span>
      <span style={s.metricLabel}>{label}</span>
    </div>
  );
}

/** Own component so each agent loads its runs independently; a failed or short history renders nothing. */
function RecallSparkline({ t, agentId }: { t: TFn; agentId: string }) {
  const { data } = useAgentEvalRuns(agentId);
  const values = React.useMemo(() => recallTrend(data?.pages.flatMap((p) => p.items) ?? []), [data]);
  if (values.length < 2) return null;
  return <Sparkline values={values} label={t("recallTrend", { count: values.length })} />;
}

function RecentRuns({ t, data, onOpen }: { t: TFn; data: Overview; onOpen: (agentId: string) => void }) {
  const names = new Map(data.agents.map((a) => [a.agent_id, a.name]));
  const runs = recentRuns(data.recent);
  return (
    <section style={s.section} aria-labelledby="eval-recent-heading">
      <h2 id="eval-recent-heading" style={s.h2}>
        {t("recentHeading")}
      </h2>
      {runs.length === 0 ? (
        <p style={s.muted}>{t("noRecent")}</p>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              {(["colAgent", "colRanAt", "colVersion", "colModel", "colMetrics", "colPassed"] as const).map((k) => (
                <th key={k} style={s.th} scope="col">
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const name = r.agent_name ?? names.get(r.agent_id) ?? t("unknownAgent");
              const when = formatRanAt(r.started_at);
              const { passed, total } = passedParts(r);
              return (
                <tr key={r.id} data-testid="eval-recent-run-row" style={s.row} onClick={() => onOpen(r.agent_id)}>
                  <td style={s.td}>
                    <button type="button" style={s.nameBtn} aria-label={t("openRun", { name, time: when })}>
                      {name}
                    </button>
                  </td>
                  <td style={s.td}>{when}</td>
                  <td style={s.td}>{t("version", { version: r.agent_version })}</td>
                  <td style={s.td} title={r.model ?? undefined}>
                    {shortModel(r.model) ?? t("noValue")}
                  </td>
                  <td style={s.td}>
                    <div style={s.bars}>
                      <MetricBar value={r.metrics.recall} color={COLORS.recall} label={t("metricRecall")} />
                      <MetricBar value={r.metrics.precision} color={COLORS.precision} label={t("metricPrecision")} />
                      <MetricBar value={r.metrics.citation_accuracy} color={COLORS.citation} label={t("metricCitation")} />
                    </div>
                  </td>
                  <td style={s.td}>
                    <div>{passed == null ? t("noValue") : t("casesValue", { passed, total })}</div>
                    {r.status !== "completed" ? <div style={s.muted}>{t(`status.${r.status}`)}</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
