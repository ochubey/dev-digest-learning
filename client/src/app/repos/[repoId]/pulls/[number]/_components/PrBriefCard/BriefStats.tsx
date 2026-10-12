"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { BriefDiffStats, IntentSource } from "@devdigest/shared";
import { getSourceColor, getSourceIcon } from "../IntentBlock/helpers";
import { s } from "./styles";

const ROLES = ["core", "tests", "wiring", "docs", "boilerplate"] as const;

interface BriefStatsProps {
  stats: BriefDiffStats | null;
  sources: IntentSource[];
}

/** Diff size, files per role and the sources the brief used. `stats: null` hides the row. */
export function BriefStats({ stats, sources }: BriefStatsProps) {
  const t = useTranslations("brief");
  if (!stats && sources.length === 0) return null;
  return (
    <div data-testid="brief-stats" style={s.stats}>
      {stats && stats.files > 0 && (
        <>
          <span>{t("stats.files", { count: stats.files })}</span>
          <span style={{ color: "var(--ok)" }}>+{stats.additions}</span>
          <span style={{ color: "var(--crit)" }}>-{stats.deletions}</span>
          {ROLES.filter((r) => stats.by_role[r] > 0).map((r) => (
            <span key={r} style={s.chip}>
              {t(`stats.role.${r}`)} {stats.by_role[r]}
            </span>
          ))}
        </>
      )}
      {sources.length > 0 && (
        <>
          <span style={s.statsLabel}>{t("stats.sources")}</span>
          {sources.map((src, i) => {
            const name = getSourceIcon(src.status);
            const SrcIcon = name ? Icon[name] : null;
            return (
              <span key={`${src.label}-${i}`} style={{ ...s.chip, color: getSourceColor(src.status) }}>
                {SrcIcon && <SrcIcon size={12} />}
                {src.label} ({t(`intent.${src.status}`)})
              </span>
            );
          })}
        </>
      )}
    </div>
  );
}
