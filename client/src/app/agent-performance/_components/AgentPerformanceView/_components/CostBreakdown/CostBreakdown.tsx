"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  EstimateLabel,
  agentEntries,
  buildBreakdown,
  formatShare,
  formatUsd,
  modelEntries,
  type CostByAgent,
  type CostByModel,
  type BreakdownEntry,
} from "@/components/agent-performance";
import { s } from "./styles";

interface Props {
  costByAgent: readonly CostByAgent[];
  costByModel: readonly CostByModel[];
  /** The server total: the footer shows it as is, shares are computed against it (AC-55, AC-56). */
  total: number | null;
}

/** Cost by agent and cost by model, every amount an estimate (AC-55..AC-58). */
export function CostBreakdown({ costByAgent, costByModel, total }: Props) {
  const t = useTranslations("agentPerformance");
  return (
    <div style={s.grid}>
      <Breakdown id="cost-by-agent" title={t("costByAgent")} entries={agentEntries(costByAgent)} total={total} />
      <Breakdown id="cost-by-model" title={t("costByModel")} entries={modelEntries(costByModel)} total={total} />
    </div>
  );
}

function Breakdown({ id, title, entries, total }: { id: string; title: string; entries: BreakdownEntry[]; total: number | null }) {
  const t = useTranslations("agentPerformance");
  const items = buildBreakdown(entries, total);
  return (
    <section style={s.section} aria-labelledby={id}>
      <h3 id={id} style={s.heading}>
        {title}
        <EstimateLabel />
      </h3>
      {total === null ? (
        <p style={s.none}>{t("noCost")}</p>
      ) : (
        <>
          <ul style={s.list}>
            {items.map((it) => (
              <li key={it.key} style={s.item}>
                <span style={s.name} title={it.label}>
                  {it.label}
                </span>
                <span style={s.amount}>{formatUsd(it.cost_usd)}</span>
                <span style={s.share}>{formatShare(it.share)}</span>
                <span style={s.bar} aria-hidden="true">
                  <span style={{ display: "block", height: "100%", width: `${Math.min(100, it.share * 100)}%`, background: "var(--accent)" }} />
                </span>
              </li>
            ))}
          </ul>
          <div style={s.footer}>
            <span>{t("breakdown.total")}</span>
            <span>{formatUsd(total)}</span>
          </div>
        </>
      )}
    </section>
  );
}
