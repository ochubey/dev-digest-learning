"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@devdigest/ui";
import type { EvalCaseResult, EvalCompare, EvalSuiteRun } from "@devdigest/shared";
import { caseChanges, deltaPt, diffWords, formatPct, manifestDiff, orderPair, type CaseChange } from "@/components/evals";
import { useEvalCompare } from "@/lib/hooks/evals";
import { EvalDialog } from "@/components/evals";
import { EVAL_TEST_IDS } from "../../../../../constants";
import { caseState, costDelta, formatCost, formatRanAt } from "../../../../../helpers";
import { buildDiffRows, chunkDiff } from "./helpers";
import { s } from "./styles";

type TFn = ReturnType<typeof useTranslations>;

export interface CompareRunsDialogProps {
  /** The two selected runs, in selection order; the older one by run time becomes A. */
  runs: readonly [EvalSuiteRun, EvalSuiteRun];
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

/** AC-67..AC-72: side-by-side comparison of two runs of the same agent. */
export function CompareRunsDialog({ runs, onClose, returnFocusRef }: CompareRunsDialogProps) {
  const t = useTranslations("evalsDashboard");
  const [older, newer] = orderPair(runs[0], runs[1]);
  const { data, isLoading, isError } = useEvalCompare(older.id, newer.id);
  const title = t("compare.title", { a: older.agent_version, b: newer.agent_version });

  return (
    <EvalDialog title={title} onClose={onClose} width={860} testId={EVAL_TEST_IDS.compareDialog} returnFocusRef={returnFocusRef}>
      {isLoading ? (
        <div role="status" aria-label={t("compare.loading")} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={80} />
          <Skeleton height={120} />
        </div>
      ) : isError || !data ? (
        <p role="alert" style={s.error}>
          {t("compare.error")}
        </p>
      ) : (
        <CompareBody t={t} data={data} />
      )}
    </EvalDialog>
  );
}

function CompareBody({ t, data }: { t: TFn; data: EvalCompare }) {
  const [a, b] = orderPair(data.a, data.b);
  const changes = caseChanges(a, b);
  const diff = manifestDiff(a.manifest, b.manifest);
  const metricRows: MetricCardProps[] = [
    { id: "recall", label: t("compare.recall"), oldValue: formatPct(a.metrics.recall), newValue: formatPct(b.metrics.recall), delta: deltaPt(b.metrics.recall, a.metrics.recall), color: "var(--accent)" },
    { id: "precision", label: t("compare.precision"), oldValue: formatPct(a.metrics.precision), newValue: formatPct(b.metrics.precision), delta: deltaPt(b.metrics.precision, a.metrics.precision), color: "var(--ok)" },
    { id: "citation", label: t("compare.citation"), oldValue: formatPct(a.metrics.citation_accuracy), newValue: formatPct(b.metrics.citation_accuracy), delta: deltaPt(b.metrics.citation_accuracy, a.metrics.citation_accuracy), color: "var(--warn)" },
    { id: "cost", label: t("compare.cost"), oldValue: formatCost(a.cost_usd), newValue: formatCost(b.cost_usd), delta: costDelta(a.cost_usd, b.cost_usd), color: "var(--text)" },
  ];
  const noValue = t("common.noValue");
  const otherCount = diff.fields.length + diff.skillsAdded.length + diff.skillsRemoved.length + diff.skillVersionChanges.length;

  return (
    <>
      <p style={s.muted}>{t("compare.subtitle", { count: b.counts?.cases_scored ?? b.results.length })}</p>
      <section style={s.section}>
        <div style={s.cards}>
          {metricRows.map((m) => (
            <MetricCard key={m.id} {...m} noValue={noValue} />
          ))}
        </div>
        <p style={s.muted}>
          {t("compare.runA", { version: a.agent_version, time: formatRanAt(a.started_at) })} ·{" "}
          {t("compare.runB", { version: b.agent_version, time: formatRanAt(b.started_at) })}
        </p>
      </section>

      <section style={s.section}>
        <h3 style={s.h3}>{t("compare.promptHeading")}</h3>
        {diff.promptChanged ? (
          <PromptDiff t={t} a={a} b={b} />
        ) : (
          <p style={s.muted}>{t("compare.promptUnchanged")}</p>
        )}
      </section>

      <section style={s.section}>
        <h3 style={s.h3}>{t("compare.otherHeading")}</h3>
        {otherCount === 0 ? (
          <p style={s.muted}>{t("compare.noOther")}</p>
        ) : (
          <ul style={s.list}>
            {diff.fields.map((f) => (
              <li key={f.key}>{t(`compare.field.${f.key}`, { from: f.from, to: f.to })}</li>
            ))}
            {diff.skillsAdded.map((n) => (
              <li key={`add-${n}`}>{t("compare.skillAdded", { name: n })}</li>
            ))}
            {diff.skillsRemoved.map((n) => (
              <li key={`rm-${n}`}>{t("compare.skillRemoved", { name: n })}</li>
            ))}
            {diff.skillVersionChanges.map((v) => (
              <li key={`v-${v.name}`}>{t("compare.skillVersion", { name: v.name, from: v.from, to: v.to })}</li>
            ))}
          </ul>
        )}
      </section>

      <section style={s.section}>
        <h3 style={s.h3}>{t("compare.casesHeading")}</h3>
        {(changes.onlyA.length > 0 || changes.onlyB.length > 0) && (
          <p style={s.notice} role="note">
            {t("compare.setsDiffer", { onlyA: changes.onlyA.length, onlyB: changes.onlyB.length })}
          </p>
        )}
        <ChangeGroup t={t} label={t("compare.regressed")} items={changes.regressed} />
        <ChangeGroup t={t} label={t("compare.fixed")} items={changes.fixed} />
        <ChangeGroup t={t} label={t("compare.errored")} items={changes.errored} />
        <p style={s.muted}>{t("compare.unchanged", { count: changes.unchanged })}</p>
        <NameGroup label={t("compare.onlyAHeading")} items={changes.onlyA} />
        <NameGroup label={t("compare.onlyBHeading")} items={changes.onlyB} />
      </section>
    </>
  );
}

interface MetricCardProps {
  id: string;
  label: string;
  oldValue: string;
  newValue: string;
  delta: string | null;
  color: string;
  noValue?: string;
}

/** One metric: muted old value, arrow, large coloured new value, delta text (direction is in the ▲/▼ text, not colour). */
function MetricCard({ id, label, oldValue, newValue, delta, color, noValue }: MetricCardProps) {
  return (
    <div style={s.card} data-testid={`eval-compare-card-${id}`}>
      <span style={s.cardLabel}>{label}</span>
      <div style={s.cardValues}>
        <span style={s.oldValue}>{oldValue}</span>
        <span style={s.arrow} aria-hidden="true">
          →
        </span>
        <span style={{ ...s.newValue, color }} data-testid={`eval-compare-new-${id}`}>
          {newValue}
        </span>
      </div>
      <span style={s.delta} data-testid={EVAL_TEST_IDS.compareDelta}>
        {delta ?? noValue}
      </span>
    </div>
  );
}

function PromptDiff({ t, a, b }: { t: TFn; a: EvalCompare["a"]; b: EvalCompare["b"] }) {
  const [expanded, setExpanded] = React.useState(false);
  const chunks = React.useMemo(() => chunkDiff(diffWords(a.manifest.system_prompt, b.manifest.system_prompt)), [a, b]);
  const rows = React.useMemo(() => buildDiffRows(chunks, 2, expanded), [chunks, expanded]);
  const hasGap = React.useMemo(() => buildDiffRows(chunks, 2, false).some((r) => r.kind === "gap"), [chunks]);
  return (
    <>
      <div style={s.legend}>
        <del style={s.del}>{t("compare.promptLegendOld", { version: a.agent_version })}</del>
        <ins style={s.ins}>{t("compare.promptLegendNew", { version: b.agent_version })}</ins>
      </div>
      <div style={s.prompt} role="group" aria-label={t("compare.promptHeading")}>
        {rows.map((row, i) =>
          row.kind === "gap" ? (
            <div key={i} style={s.gap} data-testid="eval-prompt-collapsed">
              {t("compare.promptCollapsed", { count: row.count })}
            </div>
          ) : (
            <div key={i} style={s.line}>
              {row.chunks.map((c, j) =>
                c.k === "del" ? (
                  <del key={j} style={s.del} data-testid={EVAL_TEST_IDS.promptDel}>
                    {c.text}
                  </del>
                ) : c.k === "add" ? (
                  <ins key={j} style={s.ins} data-testid={EVAL_TEST_IDS.promptIns}>
                    {c.text}
                  </ins>
                ) : (
                  <React.Fragment key={j}>{c.text}</React.Fragment>
                ),
              )}
            </div>
          ),
        )}
      </div>
      {(hasGap || expanded) && (
        <button type="button" style={s.linkBtn} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("compare.promptShowChanges") : t("compare.promptShowFull")}
        </button>
      )}
    </>
  );
}

function ChangeGroup({ t, label, items }: { t: TFn; label: string; items: CaseChange[] }) {
  return (
    <fieldset style={s.group} aria-label={label}>
      <legend style={s.groupTitle}>
        {label} ({items.length})
      </legend>
      {items.length === 0 ? (
        <p style={s.muted}>{t("compare.none")}</p>
      ) : (
        <ul style={s.list}>
          {items.map((c) => (
            <li key={c.key}>
              {t("compare.caseLine", {
                name: c.name,
                from: t(`compare.state.${stateKey(c.a)}`),
                to: t(`compare.state.${stateKey(c.b)}`),
              })}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function NameGroup({ label, items }: { label: string; items: EvalCaseResult[] }) {
  if (items.length === 0) return null;
  return (
    <fieldset style={s.group} aria-label={label}>
      <legend style={s.groupTitle}>{label}</legend>
      <ul style={s.list}>
        {items.map((r) => (
          <li key={r.id}>{r.case_name}</li>
        ))}
      </ul>
    </fieldset>
  );
}

/** Compare states are pass/fail/error; an unscored (pending) result reads as fail-neutral "fail". */
function stateKey(r: EvalCaseResult): "pass" | "fail" | "error" {
  const st = caseState(r);
  return st === "pending" ? "fail" : st;
}
