"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCaseView, EvalSuiteRun } from "@devdigest/shared";
import {
  MetricStrip,
  RunDetailDrawer,
  RunEvalControl,
  ScoringNote,
  caseResultDetail,
  caseResultLabel,
  formatPct,
  latestFinished,
  previousFinished,
  shortModel,
  sortCases,
  type CaseResultLabel,
} from "@/components/evals";
import { useAgentEvalCases, useAgentEvalRuns, useDeleteEvalCase } from "@/lib/hooks/evals";
import { EVALS_TAB_TEST_IDS as ids } from "./constants";
import { formatCost, formatRanAt, passingParts, recentRuns } from "./helpers";
import { s } from "./styles";

const RESULT_ICON: Record<CaseResultLabel, { icon: "Check" | "XCircle" | "AlertTriangle" | "Clock"; color: string }> = {
  pass: { icon: "Check", color: "var(--ok, var(--accent))" },
  fail: { icon: "XCircle", color: "var(--crit)" },
  error: { icon: "AlertTriangle", color: "var(--warn, var(--crit))" },
  never: { icon: "Clock", color: "var(--text-muted)" },
};

function CaseRow({ c, confirming, onAsk, onCancel, onConfirm, pending, failed }: {
  c: EvalCaseView;
  confirming: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
  failed: boolean;
}) {
  const t = useTranslations("evalsTab");
  const label = caseResultLabel(c);
  const detail = caseResultDetail(c);
  const { icon, color } = RESULT_ICON[label];
  const ResultIcon = Icon[icon];
  const { file, start_line, end_line, kind } = c.expectation;
  return (
    <li style={s.row} data-testid={ids.caseRow}>
      <div style={s.rowTop}>
        <span style={{ ...s.result, color }}>
          <ResultIcon size={14} />
          {t(`cases.result.${label}`)}
        </span>
        <span style={s.name} data-testid={ids.caseName}>{c.name}</span>
        <span data-testid={ids.caseKind}>
          <Badge color="var(--text-secondary)">{t(`cases.kind.${kind}`)}</Badge>
        </span>
        <span style={s.meta}>{t(`cases.origin.${c.origin}`)}</span>
        <Button
          size="sm"
          icon="Trash"
          aria-label={t("delete.ariaLabel", { name: c.name })}
          onClick={onAsk}
          disabled={confirming || pending}
        >
          {t("delete.button")}
        </Button>
      </div>
      <div style={s.mono}>{t("cases.lines", { file, start: start_line, end: end_line })}</div>
      {detail && (
        <div style={s.detail}>{t(`detail.${detail.key}`, { count: detail.count, error: detail.error ?? "" })}</div>
      )}
      {confirming && (
        <div style={s.confirm} role="group" aria-label={t("delete.ariaLabel", { name: c.name })}>
          <span>{t("delete.confirm")}</span>
          <Button kind="primary" size="sm" onClick={onConfirm} disabled={pending}>
            {t("delete.confirmYes")}
          </Button>
          <Button size="sm" onClick={onCancel}>
            {t("delete.confirmNo")}
          </Button>
        </div>
      )}
      {failed && (
        <p style={s.error} role="alert">
          {t("delete.failed")}
        </p>
      )}
    </li>
  );
}

export function EvalsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("evalsTab");
  const cases = useAgentEvalCases(agent.id);
  const runsQ = useAgentEvalRuns(agent.id);
  const del = useDeleteEvalCase();
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [failedId, setFailedId] = React.useState<string | null>(null);
  const [opened, setOpened] = React.useState<EvalSuiteRun | null>(null);

  const runs = React.useMemo(() => recentRuns(runsQ.data?.pages), [runsQ.data]);
  const allLoaded = React.useMemo(() => (runsQ.data?.pages ?? []).flatMap((p) => p.items), [runsQ.data]);
  const latest = React.useMemo(() => latestFinished(allLoaded), [allLoaded]);
  const previous = React.useMemo(() => previousFinished(allLoaded), [allLoaded]);
  const sorted = React.useMemo(() => sortCases(cases.data ?? []), [cases.data]);
  const passing = passingParts(latest);
  const hasCases = sorted.length > 0;

  const remove = (id: string) => {
    setFailedId(null);
    del.mutate(id, {
      onSuccess: () => setConfirmId(null),
      onError: () => setFailedId(id),
    });
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.title}>{t("title")}</h2>
        {passing && (
          <Badge color="var(--text-secondary)">{t("badge.passing", passing)}</Badge>
        )}
        {cases.data && <Badge color="var(--text-secondary)">{t("badge.cases", { count: sorted.length })}</Badge>}
      </div>

      {cases.isLoading ? (
        <div style={s.skeleton} role="status" aria-label={t("loading")}>
          <Skeleton height={20} width={240} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      ) : cases.isError ? (
        <ErrorState title={t("error.title")} body={t("error.body")} onRetry={() => void cases.refetch()} />
      ) : (
        <>
          {hasCases && <MetricStrip latest={latest} previous={previous} agentVersion={agent.version} />}
          <ScoringNote />
          <RunEvalControl agentId={agent.id} caseCount={sorted.length} model={agent.model} provider={agent.provider} />

          {hasCases ? (
            <section style={s.section} aria-label={t("cases.title")}>
              <ul style={s.list}>
                {sorted.map((c) => (
                  <CaseRow
                    key={c.id}
                    c={c}
                    confirming={confirmId === c.id}
                    pending={del.isPending && confirmId === c.id}
                    failed={failedId === c.id}
                    onAsk={() => {
                      setFailedId(null);
                      setConfirmId(c.id);
                    }}
                    onCancel={() => setConfirmId(null)}
                    onConfirm={() => remove(c.id)}
                  />
                ))}
              </ul>
            </section>
          ) : (
            <div style={s.empty}>
              <p style={s.emptyTitle}>{t("empty.title")}</p>
              <p style={s.hint}>{t("empty.hint")}</p>
            </div>
          )}

          <section style={s.section} aria-label={t("runs.title")}>
            <div style={s.sectionHead}>
              <h3 style={s.sectionTitle}>{t("runs.title")}</h3>
              <Link href={`/evals/${agent.id}`} style={s.link} data-testid={ids.dashboardLink}>
                {t("runs.dashboard")}
              </Link>
            </div>
            {runs.length === 0 ? (
              <p style={s.hint}>{t("runs.empty")}</p>
            ) : (
              <table style={s.table}>
                <thead>
                  <tr>
                    {(["ranAt", "version", "model", "status", "recall", "precision", "citation", "passed", "cost"] as const).map((k) => (
                      <th key={k} style={s.th} scope="col">
                        {t(`runs.col.${k}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} data-testid={ids.runRow}>
                      <td style={s.td}>
                        <button
                          type="button"
                          style={s.openBtn}
                          aria-label={t("runs.openRun", { time: formatRanAt(r.started_at) })}
                          onClick={() => setOpened(r)}
                        >
                          {formatRanAt(r.started_at)}
                        </button>
                      </td>
                      <td style={s.td}>{t("runs.version", { version: r.agent_version })}</td>
                      <td style={s.td} title={r.model ?? undefined}>
                        {shortModel(r.model) ?? t("runs.noValue")}
                      </td>
                      <td style={s.td}>{t(`runs.status.${r.status}`)}</td>
                      <td style={s.td}>{formatPct(r.metrics.recall)}</td>
                      <td style={s.td}>{formatPct(r.metrics.precision)}</td>
                      <td style={s.td}>{formatPct(r.metrics.citation_accuracy)}</td>
                      <td style={s.td}>
                        {r.counts
                          ? t("runs.passedValue", { passed: r.counts.cases_passed, total: r.counts.cases_scored })
                          : t("runs.noValue")}
                      </td>
                      <td style={s.td}>{formatCost(r.cost_usd) ?? t("runs.noValue")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
      {opened && <RunDetailDrawer run={opened} onClose={() => setOpened(null)} />}
    </div>
  );
}
