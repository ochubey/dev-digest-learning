"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import type { EvalOverview as Overview, EvalSuiteRun } from "@devdigest/shared";
import { ScoringNote, formatPct } from "@/components/evals";
import { useEvalOverview } from "@/lib/hooks/evals";
import { EVAL_TEST_IDS } from "../../constants";
import { formatRanAt, passedParts } from "../../helpers";
import { recentRuns } from "./helpers";
import { s } from "./styles";

type TFn = ReturnType<typeof useTranslations>;

function passText(t: TFn, run: EvalSuiteRun): string {
  const { passed, total } = passedParts(run);
  return t("common.passValue", { passed: passed ?? t("common.noValue"), total });
}

/** /evals landing (AC-59, AC-60, AC-64): every agent's latest eval numbers and the latest runs. */
export function EvalOverview() {
  const t = useTranslations("evalsDashboard");
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useEvalOverview();

  if (isLoading) {
    return (
      <div style={s.page} role="status" aria-label={t("overview.loading")}>
        <div style={s.skeletons}>
          <Skeleton height={26} width={240} />
          <Skeleton height={44} />
          <Skeleton height={44} />
          <Skeleton height={44} />
        </div>
      </div>
    );
  }
  if (isError || !data) {
    return (
      <ErrorState fullScreen title={t("overview.errorTitle")} body={t("overview.errorBody")} onRetry={() => void refetch()} />
    );
  }

  return (
    <div style={s.page}>
      <div>
        <h1 style={s.h1}>{t("overview.title")}</h1>
        <p style={s.subtitle}>{t("overview.subtitle")}</p>
      </div>
      <ScoringNote />
      {data.agents.length === 0 ? (
        <div style={s.empty}>
          <strong>{t("overview.emptyTitle")}</strong>
          <span style={s.muted}>{t("overview.emptyBody")}</span>
          <Link href="/agents" style={s.emptyLink}>
            {t("overview.emptyCta")}
          </Link>
        </div>
      ) : (
        <>
          <AgentsTable t={t} agents={data.agents} onOpen={(id) => router.push(`/evals/${id}`)} />
          <RecentRuns t={t} data={data} onOpen={(id) => router.push(`/evals/${id}`)} />
        </>
      )}
    </div>
  );
}

function AgentsTable({ t, agents, onOpen }: { t: TFn; agents: Overview["agents"]; onOpen: (agentId: string) => void }) {
  return (
    <section style={s.section} aria-labelledby="eval-agents-heading">
      <h2 id="eval-agents-heading" style={s.h2}>
        {t("overview.agentsHeading")}
      </h2>
      <table style={s.table}>
        <thead>
          <tr>
            {(["colAgent", "colModel", "colLatest", "colRecall", "colPrecision", "colCitation"] as const).map((k) => (
              <th key={k} style={s.th} scope="col">
                {t(`overview.${k}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.agent_id} data-testid={EVAL_TEST_IDS.agentRow} style={s.row} onClick={() => onOpen(a.agent_id)}>
              <td style={s.td}>
                <button type="button" style={s.nameBtn} aria-label={t("overview.openAgent", { name: a.name })}>
                  {a.name}
                </button>
              </td>
              <td style={s.td}>{a.model}</td>
              {a.latest ? (
                <>
                  <td style={s.td}>
                    <div>{t("common.version", { version: a.latest.agent_version })}</div>
                    <div style={s.muted}>{formatRanAt(a.latest.started_at)}</div>
                    <div>{passText(t, a.latest)}</div>
                  </td>
                  <td style={s.td}>{formatPct(a.latest.metrics.recall)}</td>
                  <td style={s.td}>{formatPct(a.latest.metrics.precision)}</td>
                  <td style={s.td}>{formatPct(a.latest.metrics.citation_accuracy)}</td>
                </>
              ) : (
                <td style={{ ...s.td, ...s.muted }} colSpan={4}>
                  {t("overview.noRuns")}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RecentRuns({ t, data, onOpen }: { t: TFn; data: Overview; onOpen: (agentId: string) => void }) {
  const names = new Map(data.agents.map((a) => [a.agent_id, a.name]));
  const runs = recentRuns(data.recent);
  return (
    <section style={s.section} aria-labelledby="eval-recent-heading">
      <h2 id="eval-recent-heading" style={s.h2}>
        {t("overview.recentHeading")}
      </h2>
      {runs.length === 0 ? (
        <p style={s.muted}>{t("overview.noRecent")}</p>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              {(["colAgent", "colRanAt", "colVersion", "colRecall", "colPrecision", "colCitation", "colPassed", "colStatus"] as const).map(
                (k) => (
                  <th key={k} style={s.th} scope="col">
                    {t(`overview.${k}`)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const name = r.agent_name ?? names.get(r.agent_id) ?? t("overview.unknownAgent");
              const when = formatRanAt(r.started_at);
              const { passed, total } = passedParts(r);
              return (
                <tr key={r.id} data-testid="eval-recent-run-row" style={s.row} onClick={() => onOpen(r.agent_id)}>
                  <td style={s.td}>
                    <button type="button" style={s.nameBtn} aria-label={t("overview.openRun", { name, time: when })}>
                      {name}
                    </button>
                  </td>
                  <td style={s.td}>{when}</td>
                  <td style={s.td}>{t("common.version", { version: r.agent_version })}</td>
                  <td style={s.td}>{formatPct(r.metrics.recall)}</td>
                  <td style={s.td}>{formatPct(r.metrics.precision)}</td>
                  <td style={s.td}>{formatPct(r.metrics.citation_accuracy)}</td>
                  <td style={s.td}>{passed == null ? t("common.noValue") : t("common.casesValue", { passed, total })}</td>
                  <td style={s.td}>{t(`status.${r.status}`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
