"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import { formatDocTokens, type FooterTotals } from "../helpers";
import { s } from "./styles";

/** "N files · X tokens total" with the soft-cap warning (icon + text) and the injection note. */
export function ContextFooter({ files, tokens, overCap }: FooterTotals) {
  const t = useTranslations("projectContext");
  return (
    <div style={s.wrap}>
      <div style={s.totalRow}>
        <span data-testid="context-footer-total" style={overCap ? s.totalWarn : s.total}>
          {t("footer.total", { count: files, tokens: formatDocTokens(tokens) })}
        </span>
        {overCap && (
          <span data-testid="context-soft-cap">
            <Badge icon="AlertTriangle" color="var(--warn)" bg="var(--warn-bg)">
              {t("footer.softCap")}
            </Badge>
          </span>
        )}
      </div>
      <div style={s.note}>{t("footer.note")}</div>
    </div>
  );
}
