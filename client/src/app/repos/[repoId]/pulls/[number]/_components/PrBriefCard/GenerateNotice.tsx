"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import { getRetryAfterSeconds, generateErrorMessage } from "./helpers";
import { useCooldown } from "./useCooldown";
import { s } from "./styles";

/** Failed-POST notice shared by the card and the inputs-changed hint:
 *  429 -> rate-limit status; anything else -> alert (server text for a 502) with Retry. */
export function GenerateNotice({
  prId,
  error,
  pending,
  onRetry,
  showCooldown = true,
}: {
  prId: string;
  /** False where another notice already shows the shared cooldown (the inputs-changed hint). */
  showCooldown?: boolean;
  error: Error | null;
  pending: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("brief");
  const remaining = useCooldown(prId);
  // Announced once on appearance: the status carries a fixed label; the ticking number is
  // aria-hidden so each second is not read out.
  if (remaining > 0 && showCooldown) {
    return (
      <div role="status" style={s.notice}>
        <Icon.Clock size={14} />
        <span style={s.srOnly}>{t("card.rateLimitedLabel")}</span>
        <span aria-hidden="true">{t("card.rateLimited", { seconds: remaining })}</span>
      </div>
    );
  }
  if (!error || getRetryAfterSeconds(error) !== null) return null;
  return (
    <div role="alert" style={s.error}>
      <Icon.AlertTriangle size={14} />
      {generateErrorMessage(error) ?? t("card.generateError")}
      <Button size="sm" kind="ghost" onClick={onRetry} disabled={pending}>
        {t("card.retry")}
      </Button>
    </div>
  );
}
