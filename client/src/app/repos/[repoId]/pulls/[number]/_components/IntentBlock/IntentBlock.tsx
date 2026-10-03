"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  SectionLabel,
  Card,
  Badge,
  Skeleton,
  ErrorState,
  EmptyState,
  Icon,
  Button,
  ConfidenceNum,
} from "@devdigest/ui";
import type { Intent } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useIntent, useRederiveIntent } from "@/lib/hooks/reviews";
import { getSourceIcon, getSourceColor, getRetryAfterSeconds, getSourceReasonKey } from "./helpers";
import { s } from "./styles";

interface IntentBlockProps {
  prId: string;
}

export function IntentBlock({ prId }: IntentBlockProps) {
  const t = useTranslations("brief");
  const { data: intent, isLoading, error, refetch } = useIntent(prId);
  const { mutate: rederive, isPending: isRederiving, error: deriveError } = useRederiveIntent(prId);
  const retryAfter = getRetryAfterSeconds(deriveError);
  const deriveErrorText = retryAfter !== null
    ? t("intent.rateLimited", { seconds: retryAfter })
    : deriveError
      ? t("intent.deriveError")
      : null;
  const deriveErrorNode = deriveErrorText ? (
    <div role="alert" style={s.deriveError}>
      {deriveErrorText}
    </div>
  ) : null;

  if (isLoading) {
    return (
      <Card style={s.wrap}>
        <SectionLabel icon="Target">{t("intent.label")}</SectionLabel>
        <div style={s.loadingWrap}>
          <Skeleton width="80%" height={16} />
          <Skeleton width="100%" height={14} />
          <Skeleton width="100%" height={14} />
        </div>
      </Card>
    );
  }

  const notDerived = error instanceof ApiError && error.status === 404;

  if (error && !notDerived) {
    return (
      <Card style={s.wrap}>
        <SectionLabel icon="Target">{t("intent.label")}</SectionLabel>
        <ErrorState
          title={t("intent.loadError")}
          body={t("intent.loadErrorBody")}
          onRetry={() => void refetch()}
        />
      </Card>
    );
  }

  if (notDerived || !intent) {
    return (
      <Card style={s.wrap}>
        <SectionLabel icon="Target">{t("intent.label")}</SectionLabel>
        <EmptyState
          icon="Target"
          title={t("intent.notDerivedTitle")}
          body={t("intent.notDerivedBody")}
          cta={t("intent.derive")}
          onCta={() => rederive()}
          ctaLoading={isRederiving}
        />
        {deriveErrorNode}
      </Card>
    );
  }

  // Confidence 0 = no description, files or sources to go on: the derived summary/scope
  // would be a guess, so show a "not enough context" state (the intent is still persisted
  // server-side; the review prompt omits it too).
  if (intent.confidence === 0) {
    return (
      <Card style={s.wrap}>
        <SectionLabel icon="Target">{t("intent.label")}</SectionLabel>
        <EmptyState
          icon="Info"
          title={t("intent.insufficientContext")}
          body={t("intent.insufficientContextBody")}
          cta={t("intent.rederive")}
          onCta={() => rederive()}
          ctaLoading={isRederiving}
        />
        {deriveErrorNode}
      </Card>
    );
  }

  return (
    <Card style={s.wrap}>
      <SectionLabel icon="Target">{t("intent.label")}</SectionLabel>

      {/* Summary quote */}
      {intent.summary && <div style={s.summary}>{intent.summary}</div>}

      {/* In Scope / Out of Scope columns */}
      <div style={s.columnsWrap}>
        {/* In Scope column */}
        <div style={s.column}>
          <div style={s.columnLabel}>{t("intent.inScope")}</div>
          {intent.in_scope && intent.in_scope.length > 0 ? (
            <div style={s.scopeItems}>
              {intent.in_scope.map((item, i) => (
                <div key={i} style={{ ...s.scopeItem, color: "var(--ok-text)" }}>
                  • {item}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
              —
            </div>
          )}
        </div>

        {/* Out of Scope column */}
        <div style={s.column}>
          <div style={s.columnLabel}>{t("intent.outOfScope")}</div>
          {intent.out_of_scope && intent.out_of_scope.length > 0 ? (
            <div style={s.scopeItems}>
              {intent.out_of_scope.map((item, i) => (
                <div key={i} style={{ ...s.scopeItem, color: "var(--text-muted)" }}>
                  • {item}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-muted)", fontStyle: "italic" }}>
              —
            </div>
          )}
        </div>
      </div>

      {/* Sources chips */}
      {intent.sources && intent.sources.length > 0 && (
        <div style={s.sourcesWrap}>
          <div style={s.columnLabel}>{t("intent.sources")}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {intent.sources.map((source, i) => {
              const IconComp = Icon[getSourceIcon(source.status) || "Info"];
              const color = getSourceColor(source.status);
              const reasonKey = getSourceReasonKey(source);
              return (
                <div key={i} style={s.sourceChip}>
                  <span style={s.sourceLabel}>{source.label}</span>
                  {IconComp && <IconComp size={13} style={{ color }} />}
                  {reasonKey && (
                    <span data-testid="source-reason" style={{ ...s.sourceReason, color }}>
                      {t(`intent.${reasonKey}`)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {deriveErrorNode}

      {/* Footer: Confidence + Stale badge + Re-derive button */}
      <div style={s.footerWrap}>
        <div style={s.confidenceWrap}>
          {intent.confidence !== undefined && (
            <ConfidenceNum value={intent.confidence} />
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {intent.stale && (
            <Badge
              icon="AlertTriangle"
              color="var(--warn)"
              bg="var(--warn-bg)"
              style={{ fontSize: 12 }}
            >
              {t("intent.stale")}
            </Badge>
          )}
          {intent.stale && (
            <Button
              kind="ghost"
              size="sm"
              icon="RefreshCw"
              loading={isRederiving}
              onClick={() => rederive()}
            >
              {t("intent.rederive")}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
