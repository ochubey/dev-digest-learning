/* DisagreementsBlock — "Where agents disagree": one row per finding group, one
   cell per finished agent's take; a switch narrows it to real conflicts. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SEV, Toggle, type Severity } from "@devdigest/ui";
import type { AgentColumn, FindingGroup } from "@devdigest/shared";
import { finishedCount, groupsToShow } from "../MultiAgentResults/helpers";
import { s } from "./styles";

export interface DisagreementsBlockProps {
  groups: FindingGroup[];
  columns: Pick<AgentColumn, "status">[];
}

export function DisagreementsBlock({ groups, columns }: DisagreementsBlockProps) {
  const t = useTranslations("multiAgent");
  const [onlyConflicts, setOnlyConflicts] = React.useState(false);
  const shown = groupsToShow(groups, onlyConflicts);
  const needTwo = finishedCount(columns) < 2;

  return (
    <section style={s.root}>
      <div style={s.head}>
        <h2 style={s.title}>{t("disagreements.title")}</h2>
        <span style={s.switchLabel}>
          <Toggle on={onlyConflicts} onChange={setOnlyConflicts} size={16} />
          <span>{t("disagreements.onlyConflicts")}</span>
        </span>
      </div>

      {needTwo ? (
        <div style={s.message}>{t("disagreements.needTwo")}</div>
      ) : shown.length === 0 ? (
        <div style={s.message}>{t("disagreements.noConflicts")}</div>
      ) : (
        <div style={s.rows}>
          {shown.map((g) => (
            <div key={g.id} style={s.row}>
              <div style={s.rowHead}>
                <span className="mono" style={s.loc}>{g.file}:{g.start_line}</span>
                <span style={s.rowTitle}>{g.title}</span>
              </div>
              <div style={s.takes(g.takes.length)}>
                {g.takes.map((take) => {
                  const flagged = take.verdict !== "ignored";
                  const color = flagged ? (SEV[take.verdict as Severity]?.c ?? "var(--warn)") : "var(--text-muted)";
                  return (
                    <div key={take.run_id} style={s.cell}>
                      <div style={s.persona}>{take.persona}</div>
                      <div style={s.verdictRow}>
                        <span style={s.dot(color)} />
                        <span style={s.verdict(flagged)}>
                          {flagged ? take.verdict : t("disagreements.didNotFlag")}
                        </span>
                      </div>
                      <div style={s.note}>{take.note}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
