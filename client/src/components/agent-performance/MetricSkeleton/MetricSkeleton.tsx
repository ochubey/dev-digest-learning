"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@devdigest/ui";
import { s } from "../styles";

/** Loading placeholder: bars only, never a number (AC-70). */
export function MetricSkeleton({ count = 4 }: { count?: number }) {
  const t = useTranslations("agentPerformance");
  return (
    <div role="status" aria-busy="true" aria-label={t("loading")} style={s.skeleton}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={i === 0 ? 24 : 16} width={i === 0 ? "40%" : "100%"} />
      ))}
    </div>
  );
}
