/* AgentTabsView — Tabs mode: one tab per agent column; the detail shows the
   agent's summary and its full FindingCard list (accept / dismiss / eval case). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, MonoLink } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { useFindingAction, usePrReviews } from "@/lib/hooks/reviews";
import { FindingCard } from "../../../pulls/[number]/_components/FindingCard";
import { formatCost, formatDuration, statusKey } from "../MultiAgentResults/helpers";
import { s } from "./styles";

export interface AgentTabsViewProps {
  columns: AgentColumn[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  onOpenTrace: (column: AgentColumn, running: boolean) => void;
}

export function AgentTabsView({ columns, prId, repoFullName, headSha, onOpenTrace }: AgentTabsViewProps) {
  const t = useTranslations("multiAgent");
  const [selected, setSelected] = React.useState(columns[0]?.run_id ?? "");
  const reviews = usePrReviews(prId);
  const action = useFindingAction();
  const col = columns.find((c) => c.run_id === selected) ?? columns[0];
  if (!col) return null;

  const findings = (reviews.data ?? []).filter((r) => r.run_id === col.run_id).flatMap((r) => r.findings);
  const nameOf = (c: AgentColumn) => (c.agent_id === null ? t("results.deletedAgent") : c.agent_name);

  return (
    <div>
      <div style={s.tabs} role="tablist">
        {columns.map((c) => (
          <button
            key={c.run_id}
            role="tab"
            aria-selected={c.run_id === col.run_id}
            style={s.tab(c.run_id === col.run_id)}
            onClick={() => setSelected(c.run_id)}
          >
            <span>{nameOf(c)}</span>
            <span className="tnum" style={s.tabAside}>
              {c.status === "done" && c.score != null ? c.score : t(`results.status.${statusKey(c.status)}`)}
            </span>
          </button>
        ))}
      </div>

      <div style={s.detail}>
        <div style={s.summary}>
          {col.status === "done" && col.score != null && <CircularScore score={col.score} size={44} stroke={4} />}
          <div style={s.summaryBody}>
            <div style={s.summaryLabel}>{t("results.summary")}</div>
            <div style={s.summaryText}>{col.summary ?? "—"}</div>
            <div className="mono" style={s.meta}>
              {formatDuration(col.duration_ms)} · {formatCost(col.cost_usd)}
              {col.status === "done" && col.score != null && ` · ${t("results.score", { score: col.score })}`}
            </div>
          </div>
          <MonoLink onClick={() => onOpenTrace(col, col.status === "running")}>{t("results.viewTrace")}</MonoLink>
        </div>

        {(col.status === "failed" || col.status === "cancelled") && col.error && (
          <div style={s.error}>{col.error}</div>
        )}
        {findings.length === 0 ? (
          col.status === "done" && <div style={s.empty}>{t("results.noFindings")}</div>
        ) : (
          <div style={s.list}>
            {findings.map((f) => (
              <FindingCard
                key={f.id}
                f={f}
                muted={f.scope === "out"}
                pending={action.isPending}
                repoFullName={repoFullName}
                headSha={headSha}
                onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
