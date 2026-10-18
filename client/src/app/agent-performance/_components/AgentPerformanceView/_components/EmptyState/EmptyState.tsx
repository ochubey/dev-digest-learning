"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { s } from "./styles";

/**
 * The dashboard with no counted run (AC-63), or no agent at all (AC-64). Both differ from an
 * agent row with zero runs (AC-65): they replace cards, table and breakdowns.
 */
export function EmptyState({ hasAgents, periodText, excluded }: { hasAgents: boolean; periodText: string; excluded: number }) {
  const t = useTranslations("agentPerformance");
  return (
    <div style={s.wrap}>
      <h2 style={s.title}>{hasAgents ? t("empty.noRunsTitle") : t("empty.noAgentsTitle")}</h2>
      <p style={s.line}>{periodText}</p>
      <p style={s.line}>{hasAgents ? t("empty.noRunsHint") : t("empty.noAgentsHint")}</p>
      {excluded > 0 && <p style={s.line}>{t("scope.excluded", { count: excluded })}</p>}
      {!hasAgents && (
        <Link href="/agents" style={s.link}>
          {t("empty.noAgentsCta")}
        </Link>
      )}
    </div>
  );
}
