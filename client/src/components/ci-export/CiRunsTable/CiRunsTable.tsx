"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { CiRun } from "@devdigest/shared";
import { formatCost, formatDuration, formatTime, safeGithubUrl } from "../helpers";
import { STATUS_COLOR, s } from "./styles";

export interface CiRunsTableProps {
  runs: CiRun[];
  /** The CI Runs page shows the agent column; the agent's own CI tab does not. */
  showAgent: boolean;
}

const COLUMNS = ["time", "repo", "pr", "agent", "verdict", "findings", "cost", "duration", "status", "link"] as const;

/** CI runs table (AC-72..74, AC-80). Every GitHub-provided string is rendered as plain text. */
export function CiRunsTable({ runs, showAgent }: CiRunsTableProps) {
  const t = useTranslations("ciRuns.table");
  const none = t("noValue");
  const cols = COLUMNS.filter((c) => showAgent || c !== "agent");

  const statusLabel = (status: string | null) =>
    status && status in STATUS_COLOR ? t(`status.${status as "succeeded"}`) : (status ?? none);

  return (
    <div style={s.wrap}>
      <table style={s.table}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col" style={s.th}>
                {t(`col.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const href = safeGithubUrl(r.github_url);
            const counts = [
              r.critical ? t("critical", { count: r.critical }) : null,
              r.warning ? t("warning", { count: r.warning }) : null,
              r.suggestion ? t("suggestion", { count: r.suggestion }) : null,
            ].filter((v): v is string => v != null);
            const unknownFindings = r.critical == null && r.warning == null && r.suggestion == null;
            const durationMs = r.duration_ms ?? (r.duration_s != null ? r.duration_s * 1000 : null);
            const failed = r.status === "failed";
            return (
              <tr key={r.id}>
                <td style={s.td}>{formatTime(r.ran_at)}</td>
                <td style={{ ...s.td, ...s.mono }}>{r.repo ?? none}</td>
                <td style={s.td}>
                  {r.pr_number != null && <span style={s.prNumber}>#{r.pr_number}</span>}
                  <span style={s.title}>{r.pr_title ?? (r.pr_number == null ? none : "")}</span>
                </td>
                {showAgent && <td style={s.td}>{r.agent ?? none}</td>}
                <td style={s.td}>
                  {r.verdict ? t(`verdicts.${r.verdict as "APPROVE"}`) : none}
                </td>
                <td style={s.td}>
                  {unknownFindings || failed ? (
                    none
                  ) : counts.length === 0 ? (
                    "0"
                  ) : (
                    <div style={s.findings}>
                      {counts.map((c) => (
                        <span key={c}>{c}</span>
                      ))}
                    </div>
                  )}
                </td>
                <td style={s.td}>{failed ? none : formatCost(r.cost_usd)}</td>
                <td style={s.td}>{failed ? none : formatDuration(durationMs)}</td>
                <td style={s.td}>
                  <Badge color={STATUS_COLOR[r.status ?? ""] ?? "var(--text-secondary)"} dot>
                    {statusLabel(r.status)}
                  </Badge>
                  {failed && r.reason && <div style={s.reason}>{r.reason}</div>}
                </td>
                <td style={s.td}>
                  {href && (
                    <a href={href} target="_blank" rel="noopener noreferrer" style={s.link}>
                      {t("viewJob")}
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
