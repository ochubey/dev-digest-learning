"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";
import { SEVERITY_COLOR } from "./constants";
import { riskKindIcon, riskKindLabelKey, riskLabel, riskRefLine } from "./helpers";
import { s } from "./styles";

interface RiskListProps {
  risks: Risk[];
  onOpenRef: (file: string, line: number | null) => void;
}

/**
 * Risks as given. The chevron button toggles the explanation and all file refs; each ref is its
 * own navigate button, so neither control triggers the other (AC-73).
 */
export function RiskList({ risks, onOpenRef }: RiskListProps) {
  const t = useTranslations("brief");
  const baseId = React.useId();
  const [open, setOpen] = React.useState<Set<number>>(() => new Set());
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(i)) next.add(i);
      return next;
    });

  if (risks.length === 0) return <p style={s.muted}>{t("noRisks")}</p>;
  return (
    <ul style={s.list}>
      {risks.map((risk, i) => {
        const KindIcon = Icon[riskKindIcon(risk.kind)];
        const Chevron = open.has(i) ? Icon.ChevronDown : Icon.ChevronRight;
        const expanded = open.has(i);
        const regionId = `${baseId}-risk-${i}`;
        const label = riskLabel(risk);
        const primary = risk.anchor?.file ?? risk.file_refs[0];
        // Collapsed: one button for the anchor file (or the first ref). Expanded: every ref.
        const refs = expanded ? risk.file_refs : primary ? [primary] : [];
        const refButton = (file: string) => {
          const text = file === primary ? label : file;
          return (
            <button
              key={file}
              type="button"
              style={s.fileLink}
              aria-label={t("card.openRef", { file: text })}
              onClick={() => onOpenRef(file, riskRefLine(risk, file))}
            >
              {text}
            </button>
          );
        };
        return (
          <li key={`${risk.title}-${i}`} style={s.riskItem}>
            <div style={s.riskHeader}>
              <button
                type="button"
                style={s.chevron}
                aria-expanded={expanded}
                aria-controls={regionId}
                aria-label={t("card.expandRisk", { title: risk.title })}
                onClick={() => toggle(i)}
              >
                <Chevron size={14} />
              </button>
              <KindIcon size={14} role="img" aria-label={t(riskKindLabelKey(risk.kind))} />
              <span style={s.riskTitle}>{risk.title}</span>
              <span style={{ ...s.severity, color: SEVERITY_COLOR[risk.severity] }}>
                {t(`severity.${risk.severity}`)}
              </span>
              {!expanded && refs.map(refButton)}
            </div>
            {expanded && (
              <div id={regionId} role="region" aria-label={risk.title} style={s.riskBody}>
                <p style={s.riskExplanation}>{risk.explanation}</p>
                <div style={s.refList}>{refs.map(refButton)}</div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
