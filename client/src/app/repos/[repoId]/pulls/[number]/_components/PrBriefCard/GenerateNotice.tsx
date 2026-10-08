"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import { getRetryAfterSeconds, generateErrorMessage } from "./helpers";
import { s } from "./styles";

/** Failed-POST notice shared by the card and the inputs-changed hint:
 *  429 -> rate-limit status; anything else -> alert (server text for a 502) with Retry. */
export function GenerateNotice({
  error,
  pending,
  onRetry,
}: {
  error: Error | null;
  pending: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("brief");
  if (!error) return null;
  const retryAfter = getRetryAfterSeconds(error);
  if (retryAfter !== null) {
    return (
      <div role="status" style={s.notice}>
        <Icon.Clock size={14} />
        {t("card.rateLimited", { seconds: retryAfter })}
      </div>
    );
  }
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
