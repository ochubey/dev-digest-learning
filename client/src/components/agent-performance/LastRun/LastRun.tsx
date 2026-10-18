"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { formatDateTime } from "../format";
import { s } from "../styles";

/** Three distinct renderings: last run in the period, none in the period but one before, never run (AC-50). */
export function LastRun({ lastRunAt, allTime }: { lastRunAt: string | null; allTime: string | null }) {
  const t = useTranslations("agentPerformance.lastRun");
  if (lastRunAt) return <time dateTime={lastRunAt}>{formatDateTime(lastRunAt)}</time>;
  if (allTime) return <span style={s.muted}>{t("noneInPeriod", { date: formatDateTime(allTime) })}</span>;
  return <span style={s.muted}>{t("never")}</span>;
}
