"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalSuiteRun } from "@devdigest/shared";
import { METRIC_NAME, regression } from "../../helpers";
import { s } from "./styles";

export interface RunsAlertBannerProps {
  runs: readonly EvalSuiteRun[];
}

/** Warns when the newest finished run is worse than the previous finished run on any metric. */
export function RunsAlertBanner({ runs }: RunsAlertBannerProps) {
  const t = useTranslations("evalsAgentPage");
  const reg = React.useMemo(() => regression(runs), [runs]);
  if (!reg) return null;
  const dropped = reg.dropped
    .map((d) => t("banner.dippedMetric", { metric: t(`metricName.${METRIC_NAME[d.key]}`), pt: d.pt }))
    .join(", ");
  const others = reg.others
    .map((o) => {
      const metric = t(`metricName.${METRIC_NAME[o.key]}Lower`);
      return o.kind === "up" ? t("banner.upMetric", { metric, pt: o.pt }) : t("banner.flatMetric", { metric });
    })
    .join(", ");
  const text = others ? t("banner.withOthers", { dropped, version: reg.version, others }) : t("banner.only", { dropped, version: reg.version });
  return (
    <div role="status" style={s.wrap} data-testid="eval-regression-banner">
      <Icon.AlertTriangle size={16} style={s.icon} aria-label={t("banner.iconLabel")} />
      <p style={s.text}>{text}</p>
    </div>
  );
}
