"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { AgentStats } from "@devdigest/shared";
import {
  AcceptRate,
  DEFAULT_SORT,
  EstimateLabel,
  LastRun,
  formatDuration,
  formatUsd,
  nextSort,
  sortAgents,
  type Period,
  type SortKey,
  type SortState,
} from "@/components/agent-performance";
import { COLUMNS, SEVERITIES } from "./constants";
import { s } from "./styles";

/** Stats tab URL with the exact instants of the dashboard response (AC-52). */
function statsHref(agentId: string, period: Period): string {
  const sp = new URLSearchParams({ tab: "stats", from: period.from, to: period.to });
  return `/agents/${agentId}?${sp.toString()}`;
}

/**
 * One row per agent (AC-42): sortable headers, an expand button, and details taken from the
 * already loaded response, so sorting and expanding send no request (AC-53, AC-73).
 */
export function AgentTable({ agents, period }: { agents: readonly AgentStats[]; period: Period }) {
  const t = useTranslations("agentPerformance");
  const uid = React.useId();
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());
  const rows = React.useMemo(() => sortAgents(agents, sort), [agents, sort]);
  const column = COLUMNS.find((c) => c.key === sort.key)!;

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const ariaSort = (key: SortKey) => (sort.key !== key ? "none" : sort.dir === "asc" ? "ascending" : "descending");

  return (
    <section style={s.section} aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} style={s.h2}>
        {t("perAgent")}
      </h2>
      <p role="status" style={s.status}>
        {t("sort.status", { column: t(`sort.${column.sortLabel}`), direction: t(`sort.${sort.dir}`) })}
      </p>
      <div style={s.scroll}>
        <table style={s.table}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" style={s.th} aria-sort={ariaSort(c.key)}>
                  <span style={s.thInner}>
                    <button type="button" style={s.sortBtn} onClick={() => setSort((cur) => nextSort(cur, c.key))}>
                      {t(`table.${c.label}`)}
                      {sort.key === c.key && (sort.dir === "asc" ? <Icon.ArrowUp size={12} aria-hidden="true" /> : <Icon.ArrowDown size={12} aria-hidden="true" />)}
                    </button>
                    {c.key === "cost" && <EstimateLabel />}
                  </span>
                </th>
              ))}
              <th scope="col" style={s.th}>
                {t("table.view")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const expanded = open.has(a.agent_id);
              const detailId = `${uid}-d-${a.agent_id}`;
              return (
                <React.Fragment key={a.agent_id}>
                  <tr>
                    <td style={s.td}>
                      <div style={s.agentCell}>
                        <button
                          type="button"
                          style={s.expandBtn}
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          aria-label={t("table.details", { agent: a.agent_name })}
                          onClick={() => toggle(a.agent_id)}
                        >
                          {expanded ? <Icon.ChevronDown size={14} aria-hidden="true" /> : <Icon.ChevronRight size={14} aria-hidden="true" />}
                        </button>
                        <span data-testid="agent-name" style={s.name} title={a.agent_name}>
                          {a.agent_name}
                        </span>
                      </div>
                    </td>
                    <td style={s.td}>{a.runs}</td>
                    <td style={s.td}>{formatUsd(a.avg_cost_usd)}</td>
                    <td style={s.td}>{formatDuration(a.avg_latency_ms)}</td>
                    <td style={s.td}>
                      <AcceptRate rate={a.accept_rate} accepted={a.accepted} decisions={a.decisions} />
                    </td>
                    <td style={s.td}>
                      <LastRun lastRunAt={a.last_run_at} allTime={a.last_run_at_all_time} />
                    </td>
                    <td style={s.td}>
                      <Link href={statsHref(a.agent_id, period)} style={s.link} aria-label={t("table.viewStats", { agent: a.agent_name })}>
                        {t("table.view")}
                      </Link>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td id={detailId} colSpan={COLUMNS.length + 1} style={s.detailTd}>
                        <Details agent={a} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Details({ agent: a }: { agent: AgentStats }) {
  const t = useTranslations("agentPerformance.detail");
  const item = (label: string, value: React.ReactNode, estimate = false) => (
    <div key={label} style={s.detailItem}>
      <dt style={s.detailLabel}>
        {label}
        {estimate && <EstimateLabel />}
      </dt>
      <dd style={s.detailValue}>{value}</dd>
    </div>
  );
  return (
    <dl style={s.detail}>
      {item(t("accepted"), a.accepted)}
      {item(t("dismissed"), a.dismissed)}
      {item(t("pending"), a.pending)}
      {item(t("excluded"), a.runs_excluded)}
      {item(t("withCost"), a.runs_with_cost)}
      {item(t("withoutCost"), a.runs_without_cost)}
      {item(t("totalCost"), formatUsd(a.total_cost_usd), true)}
      {SEVERITIES.map((sev) => item(t(sev.label), a.findings_by_severity[sev.key]))}
    </dl>
  );
}
