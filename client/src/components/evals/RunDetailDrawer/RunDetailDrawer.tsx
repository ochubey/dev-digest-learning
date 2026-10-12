"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@devdigest/ui";
import type { EvalCaseResult, EvalResultFinding, EvalSuiteRun } from "@devdigest/shared";
import { useEvalRun } from "@/lib/hooks/evals";
import { EvalDialog } from "../EvalDialog";
import { caseState, formatRanAt, sortCases } from "../helpers";
import { s } from "./styles";

type TFn = ReturnType<typeof useTranslations>;

export interface RunDetailDrawerProps {
  /** Summary row the drawer was opened from (gives the title before the detail loads). */
  run: EvalSuiteRun;
  onClose: () => void;
}

const loc = (f: { file: string; start_line: number; end_line: number }) => `${f.file}:${f.start_line}-${f.end_line}`;

/** AC-65: per-case results of one run. All text is rendered as plain text nodes (AC-83). */
export function RunDetailDrawer({ run, onClose }: RunDetailDrawerProps) {
  const t = useTranslations("evalsDashboard");
  const { data, isLoading, isError } = useEvalRun(run.id);
  const title = t("drawer.title", { time: formatRanAt(run.started_at), version: run.agent_version });
  const results = data ? sortCases(data.results.map((r) => ({ ...r, name: r.case_name, expectation: r.expectation }))) : [];

  return (
    <EvalDialog title={title} onClose={onClose} side="right" width={680} testId="eval-run-drawer">
      {isLoading ? (
        <div role="status" aria-label={t("drawer.loading")} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={60} />
          <Skeleton height={60} />
        </div>
      ) : isError || !data ? (
        <p role="alert" style={s.error}>
          {t("drawer.error")}
        </p>
      ) : (
        <>
          <p style={s.summary}>{t("drawer.summary", { status: t(`status.${data.status}`), cases: data.results.length })}</p>
          {data.error && (
            <p role="alert" style={s.error}>
              {t("drawer.runError", { message: data.error })}
            </p>
          )}
          {results.length === 0 ? (
            <p style={s.muted}>{t("drawer.noResults")}</p>
          ) : (
            <ul style={s.list}>
              {results.map((r) => (
                <CaseCard key={r.id} t={t} r={r} />
              ))}
            </ul>
          )}
        </>
      )}
    </EvalDialog>
  );
}

function FindingList({ t, title, items }: { t: TFn; title: string; items: EvalResultFinding[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p style={s.groupTitle}>{title}</p>
      <ul style={s.findings}>
        {items.map((f, i) => (
          <li key={i} style={s.finding}>
            <span>
              {loc(f)} · {f.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CaseCard({ t, r }: { t: TFn; r: EvalCaseResult }) {
  const state = caseState(r);
  const matched = r.grounded.filter((f) => f.match === "tp");
  const unlabeled = r.grounded.filter((f) => f.match === "unlabeled");
  const zone = r.grounded.filter((f) => f.match === "fp_zone");
  return (
    <li style={s.card} data-testid="eval-case-result">
      <div style={s.head}>
        <span style={s.name}>{r.case_name}</span>
        <span style={s.tag}>{t(`drawer.kind.${r.expectation.kind}`)}</span>
        <span style={s.tag}>{t(`drawer.result.${state}`)}</span>
      </div>
      <p style={s.expected}>{t("drawer.expected", { file: r.expectation.file, start: r.expectation.start_line, end: r.expectation.end_line })}</p>
      <FindingList t={t} title={t("drawer.matched")} items={matched} />
      <FindingList t={t} title={t("drawer.fpZone")} items={zone} />
      <FindingList t={t} title={t("drawer.unlabeled")} items={unlabeled} />
      {r.dropped.length > 0 && (
        <div>
          <p style={s.groupTitle}>{t("drawer.dropped")}</p>
          <ul style={s.findings}>
            {r.dropped.map((d, i) => (
              <li key={i} style={s.finding}>
                <span>
                  {loc(d)} · {d.title}
                </span>
                <span style={s.reason}>{t("drawer.droppedReason", { reason: d.reason })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.status === "error" && r.error && <p style={s.error}>{t("drawer.errorMessage", { message: r.error })}</p>}
    </li>
  );
}
