"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { EvalSuiteRun } from "@devdigest/shared";
import { formatPct } from "@/components/evals";
import { EVAL_TEST_IDS } from "../../../../../constants";
import { formatCost, formatRanAt, passedParts } from "../../../../../helpers";
import { s } from "./styles";

export interface RunsTableProps {
  runs: readonly EvalSuiteRun[];
  selected: readonly string[];
  onToggle: (runId: string) => void;
  onOpen: (run: EvalSuiteRun) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

const COLUMNS = ["colSelect", "colRanAt", "colVersion", "colStatus", "colRecall", "colPrecision", "colCitation", "colPassed", "colCost"] as const;

/** AC-61/AC-62: the agent's runs, newest first, with a real checkbox per row and Load more. */
export function RunsTable({ runs, selected, onToggle, onOpen, hasMore, loadingMore, onLoadMore }: RunsTableProps) {
  const t = useTranslations("evalsDashboard");
  return (
    <div style={s.wrap}>
      <table style={s.table}>
        <thead>
          <tr>
            {COLUMNS.map((k) => (
              <th key={k} style={s.th} scope="col">
                {t(`agent.${k}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const when = formatRanAt(r.started_at);
            const { passed, total } = passedParts(r);
            return (
              <tr key={r.id} data-testid={EVAL_TEST_IDS.runRow}>
                <td style={s.td}>
                  <input
                    type="checkbox"
                    data-testid={EVAL_TEST_IDS.runSelect}
                    checked={selected.includes(r.id)}
                    onChange={() => onToggle(r.id)}
                    aria-label={t("agent.selectRun", { time: when, version: r.agent_version })}
                  />
                </td>
                <td style={s.td}>
                  <button type="button" style={s.linkBtn} onClick={() => onOpen(r)} aria-label={t("agent.openRun", { time: when })}>
                    {when}
                  </button>
                </td>
                <td style={s.td}>{t("common.version", { version: r.agent_version })}</td>
                <td style={s.td}>{t(`status.${r.status}`)}</td>
                <td style={s.td}>{formatPct(r.metrics.recall)}</td>
                <td style={s.td}>{formatPct(r.metrics.precision)}</td>
                <td style={s.td}>{formatPct(r.metrics.citation_accuracy)}</td>
                <td style={s.td}>{passed == null ? t("common.noValue") : t("common.casesValue", { passed, total })}</td>
                <td style={s.td}>{formatCost(r.cost_usd)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <Button size="sm" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? t("agent.loadingMore") : t("agent.loadMore")}
        </Button>
      )}
    </div>
  );
}
