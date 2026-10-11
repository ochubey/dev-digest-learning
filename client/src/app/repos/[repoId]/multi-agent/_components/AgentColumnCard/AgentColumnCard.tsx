/* AgentColumnCard — one agent's column in the Columns view: status, duration/cost,
   score, error, compact findings and a View trace footer. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, Icon, MonoLink, SEV, type Severity } from "@devdigest/ui";
import type { AgentColumn } from "@devdigest/shared";
import { TRUNCATE_AT } from "../MultiAgentResults/constants";
import { formatCost, formatDuration, isTerminal, statusKey, truncate } from "../MultiAgentResults/helpers";
import { s } from "./styles";

export interface AgentColumnCardProps {
  column: AgentColumn;
  /** Finding id -> names of the other agents that flagged the same group. */
  alsoFlagged: Map<string, string[]>;
  onOpenTrace: (column: AgentColumn, running: boolean) => void;
}

export function AgentColumnCard({ column, alsoFlagged, onOpenTrace }: AgentColumnCardProps) {
  const t = useTranslations("multiAgent");
  const terminal = isTerminal(column.status);
  const name = column.agent_id === null ? t("results.deletedAgent") : column.agent_name;
  const showError = (column.status === "failed" || column.status === "cancelled") && column.error;

  return (
    <div style={s.card} data-testid="agent-column">
      <div style={s.head}>
        <div style={s.headBody}>
          <div style={s.name} title={name}>{name}</div>
          <div className="mono tnum" style={s.meta}>
            {terminal ? `${formatDuration(column.duration_ms)} · ${formatCost(column.cost_usd)}` : "—"}
          </div>
          <div style={s.status}>{t(`results.status.${statusKey(column.status)}`)}</div>
        </div>
        {column.status === "done" && column.score != null && (
          <CircularScore score={column.score} size={32} stroke={3.5} />
        )}
      </div>

      <div style={s.body}>
        {showError && <div style={s.error}>{column.error}</div>}
        {column.findings.length === 0 && column.status === "done" && (
          <div style={s.empty}>{t("results.noFindings")}</div>
        )}
        {column.findings.map((f) => {
          const sev = SEV[f.severity as Severity] ?? SEV.INFO;
          const Ic = Icon[sev.icon];
          const loc = truncate(`${f.file}:${f.start_line}`, TRUNCATE_AT);
          const others = alsoFlagged.get(f.id);
          return (
            <div key={f.id} style={s.item(sev.c)}>
              <div style={s.itemTitle} title={f.title}>
                <Ic size={12} style={{ color: sev.c, flexShrink: 0 }} />
                <span>{truncate(f.title, TRUNCATE_AT)}</span>
              </div>
              <div className="mono" style={s.itemLoc} title={`${f.file}:${f.start_line}`}>{loc}</div>
              {others && others.length > 0 && (
                <div style={s.also}>{t("results.alsoFlaggedBy", { names: others.join(", ") })}</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={s.footer}>
        <MonoLink onClick={() => onOpenTrace(column, column.status === "running")}>
          {t("results.viewTrace")}
        </MonoLink>
        <span style={s.count}>{t("results.findingsCount", { count: column.findings.length })}</span>
      </div>
    </div>
  );
}
