"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import { LOW_SAMPLE_MIN } from "../constants";
import { formatRate } from "../format";
import { s } from "../styles";

/** Accept rate with its denominator: "75% 6/8", a low-sample marker for 1..4 decisions, "n/a · 0 decisions" for none (AC-43). */
export function AcceptRate({ rate, accepted, decisions }: { rate: number | null; accepted: number; decisions: number }) {
  const t = useTranslations("agentPerformance.rate");
  if (decisions === 0 || rate === null) return <span style={s.muted}>{t("na")}</span>;
  return (
    <span style={s.rate}>
      <span style={s.rateValue}>{formatRate(rate)}</span>
      <span style={s.muted}>{t("fraction", { accepted, decisions })}</span>
      {decisions < LOW_SAMPLE_MIN && <Badge color="var(--text-muted)">{t("lowSample")}</Badge>}
    </span>
  );
}
