"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { s } from "./styles";

/** AC-31: the mechanical scoring note plus the "How metrics are computed" disclosure. */
export function ScoringNote() {
  const t = useTranslations("evalsShared");
  return (
    <div style={s.wrap} data-testid="eval-scoring-note">
      <p style={{ margin: 0 }}>{t("scoring.note")}</p>
      <details>
        <summary style={s.summary}>{t("scoring.summary")}</summary>
        <ul style={s.list}>
          <li>{t("scoring.recall")}</li>
          <li>{t("scoring.precision")}</li>
          <li>{t("scoring.citation")}</li>
        </ul>
        <strong>{t("scoring.limitsTitle")}</strong>
        <ul style={s.list}>
          <li>{t("scoring.limitSemantic")}</li>
          <li>{t("scoring.limitShifted")}</li>
        </ul>
      </details>
    </div>
  );
}
