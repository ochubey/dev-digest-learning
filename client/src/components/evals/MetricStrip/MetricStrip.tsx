"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalSuiteRun } from "@devdigest/shared";
import { deltaPt, formatPct, nullReason, versionDrift, type EvalMetricKey } from "../helpers";
import { METRIC_TEST_IDS } from "./constants";
import { passedParts } from "./helpers";
import { s } from "./styles";

export interface MetricStripProps {
  /** Latest finished run, or null when the agent has never finished a run. */
  latest: EvalSuiteRun | null;
  /** The finished run before `latest`, for deltas. */
  previous?: EvalSuiteRun | null;
  /** The agent's current version, for the drift notice. */
  agentVersion?: number | null;
}

const METRICS: { key: EvalMetricKey; label: string; tip: string }[] = [
  { key: "recall", label: "recall", tip: "recallTooltip" },
  { key: "precision", label: "precision", tip: "precisionTooltip" },
  { key: "citation_accuracy", label: "citation", tip: "citationTooltip" },
];

export function MetricStrip({ latest, previous = null, agentVersion }: MetricStripProps) {
  const t = useTranslations("evalsShared");
  if (!latest) {
    return (
      <p style={s.empty} data-testid="eval-metric-strip-empty">
        {t("metric.noRuns")}
      </p>
    );
  }
  const drift = versionDrift(latest, agentVersion);
  const { passed, total } = passedParts(latest);
  return (
    <div style={s.wrap} role="group" aria-label={t("metric.recall") + " / " + t("metric.precision") + " / " + t("metric.citation")}>
      {drift && (
        <p style={s.notice} role="note">
          {t("metric.drift", { from: drift.from, to: drift.to })}
        </p>
      )}
      <div style={s.row}>
        {METRICS.map(({ key, label, tip }) => {
          const value = latest.metrics[key];
          const isNull = value == null;
          const delta = deltaPt(value, previous?.metrics[key]);
          const reason = t(`metric.nullReason.${nullReason(key)}`);
          return (
            <div key={key} style={s.card} data-testid={METRIC_TEST_IDS[key]} title={isNull ? reason : t(`metric.${tip}`)}>
              <span style={s.label}>{t(`metric.${label}`)}</span>
              <span style={s.value}>{isNull ? t("metric.noValue") : formatPct(value)}</span>
              {isNull && <span style={s.delta}>{reason}</span>}
              {delta && (
                <span style={s.delta} title={t("metric.deltaTooltip")}>
                  {delta}
                </span>
              )}
            </div>
          );
        })}
        <div style={s.card} data-testid={METRIC_TEST_IDS.passed} title={t("metric.passedTooltip")}>
          <span style={s.label}>{t("metric.passed")}</span>
          <span style={s.value}>
            {passed == null ? t("metric.noValue") : t("metric.passedValue", { passed, total })}
          </span>
        </div>
      </div>
    </div>
  );
}
