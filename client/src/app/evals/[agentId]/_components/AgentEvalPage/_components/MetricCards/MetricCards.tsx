"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalSuiteRun } from "@devdigest/shared";
import { Sparkline, deltaPt, formatPct, nullReason, passedParts, versionDrift } from "@/components/evals";
import { METRIC_KEYS, METRIC_NAME, SPARKLINE_RUNS, recentSeries } from "../../helpers";
import { s } from "./styles";

export interface MetricCardsProps {
  latest: EvalSuiteRun | null;
  previous: EvalSuiteRun | null;
  agentVersion: number;
  /** Runs the sparklines are drawn from (the last 8 finished ones). */
  runs: readonly EvalSuiteRun[];
}

const TEST_IDS = { recall: "eval-metric-recall", precision: "eval-metric-precision", citation_accuracy: "eval-metric-citation" } as const;
const COLORS = { recall: "var(--accent)", precision: "var(--ok)", citation_accuracy: "var(--warn)", passed: "var(--text-secondary)" } as const;
const TIPS = { recall: "recallTooltip", precision: "precisionTooltip", citation_accuracy: "citationTooltip" } as const;

/** The four metric cards of the agent page: value, delta and a sparkline of the last finished runs.
    Same numbers, test ids and wording as `MetricStrip`, which has no room for a trend line. */
export function MetricCards({ latest, previous, agentVersion, runs }: MetricCardsProps) {
  const t = useTranslations("evalsShared");
  const ta = useTranslations("evalsAgentPage");
  if (!latest) return <p style={s.empty} data-testid="eval-metric-strip-empty">{t("metric.noRuns")}</p>;
  const drift = versionDrift(latest, agentVersion);
  const { passed, total } = passedParts(latest);
  const spark = (key: (typeof METRIC_KEYS)[number] | "passed", name: string) => {
    const values = recentSeries(runs, key, SPARKLINE_RUNS);
    return (
      <Sparkline
        values={values}
        color={COLORS[key]}
        label={ta("cards.trendLabel", { metric: name, count: values.length })}
      />
    );
  };
  return (
    <div style={s.wrap} role="group" aria-label={`${t("metric.recall")} / ${t("metric.precision")} / ${t("metric.citation")}`}>
      {drift && (
        <p style={s.notice} role="note">
          {t("metric.drift", { from: drift.from, to: drift.to })}
        </p>
      )}
      <div style={s.row}>
        {METRIC_KEYS.map((key) => {
          const value = latest.metrics[key];
          const isNull = value == null;
          const delta = deltaPt(value, previous?.metrics[key]);
          const reason = t(`metric.nullReason.${nullReason(key)}`);
          const name = t(`metric.${METRIC_NAME[key]}`);
          return (
            <div key={key} style={s.card} data-testid={TEST_IDS[key]} title={isNull ? reason : t(`metric.${TIPS[key]}`)}>
              <span style={s.label}>{name}</span>
              <div style={s.valueRow}>
                <span style={s.value}>{isNull ? t("metric.noValue") : formatPct(value)}</span>
                {spark(key, name)}
              </div>
              {isNull && <span style={s.delta}>{reason}</span>}
              {delta && (
                <span style={s.delta} title={t("metric.deltaTooltip")}>
                  {delta}
                </span>
              )}
            </div>
          );
        })}
        <div style={s.card} data-testid="eval-metric-passed" title={t("metric.passedTooltip")}>
          <span style={s.label}>{t("metric.passed")}</span>
          <div style={s.valueRow}>
            <span style={s.value}>{passed == null ? t("metric.noValue") : t("metric.passedValue", { passed, total })}</span>
            {spark("passed", t("metric.passed"))}
          </div>
        </div>
      </div>
    </div>
  );
}
