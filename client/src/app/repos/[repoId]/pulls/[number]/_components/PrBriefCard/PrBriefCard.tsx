"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, Button, EmptyState, ErrorState, SectionLabel, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { usePrBrief, useGenerateBrief, useIsGeneratingBrief } from "@/lib/hooks/brief";
import { notify } from "@/lib/toast";
import { costTokensParts, formatCost, formatTokens, isInDiff, missingLabels } from "./helpers";
import { TOKENS_ARROW } from "./constants";
import { useCooldown } from "./useCooldown";
import { GenerateNotice } from "./GenerateNotice";
import { BriefSkeleton } from "./BriefSkeleton";
import { BriefStats } from "./BriefStats";
import { RiskList } from "./RiskList";
import { ReviewFocusList } from "./ReviewFocusList";
import { s } from "./styles";

export interface PrBriefCardProps {
  prId: string;
  /** Paths present in this PR diff (used by navigation, P6). */
  diffPaths: Set<string>;
  /** Open a file (and optionally a line) in the Files changed tab. */
  onOpenInDiff: (file: string, line: number | null) => void;
  /** Rendered inside the card in every state (Intent / Blast Radius, advisory hint). */
  children?: React.ReactNode;
  /** Rendered directly under the header rows (stale badge / missing note), e.g. the inputs-changed hint. */
  notice?: React.ReactNode;
}

export function PrBriefCard({ prId, diffPaths, onOpenInDiff, children, notice }: PrBriefCardProps) {
  const t = useTranslations("brief");
  const { data, error, isLoading, refetch } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);

  // 404 = never generated (or unreadable old shape): empty state, even if a refetch after a
  // 429 lands on it while older data is still cached.
  const notGenerated = error instanceof ApiError && error.status === 404;
  const brief = notGenerated ? undefined : data;
  // Any in-flight generation for this PR (also one started from the inputs-changed hint).
  const generating = useIsGeneratingBrief(prId);
  const pending = generate.isPending || generating;
  const cooling = useCooldown(prId) > 0;

  const generateNotice = (
    <GenerateNotice prId={prId} error={generate.error} pending={pending} onRetry={() => generate.mutate()} />
  );

  // A ref outside the diff cannot be opened: tell the user instead of navigating (AC-42).
  const navigate = (file: string, line: number | null) => {
    if (!isInDiff(file, diffPaths)) {
      notify.info(t("card.notInDiff"));
      return;
    }
    onOpenInDiff(file, line);
  };

  const title = <SectionLabel icon="Sparkles">{t("card.title")}</SectionLabel>;

  if (isLoading) {
    return (
      <Card style={s.wrap}>
        {title}
        <div style={s.loadingWrap}>
          <Skeleton width="80%" height={16} />
          <Skeleton width="100%" height={14} />
          <Skeleton width="100%" height={14} />
        </div>
        {children}
      </Card>
    );
  }

  if (error && !notGenerated && !brief) {
    return (
      <Card style={s.wrap}>
        {title}
        <ErrorState title={t("card.loadError")} onRetry={() => void refetch()} />
        {children}
      </Card>
    );
  }

  if (!brief) {
    return (
      <Card style={s.wrap}>
      <div aria-busy={pending}>
        {title}
        {/* A disabled fieldset disables the CTA during the cooldown without a spinner. */}
        <fieldset disabled={cooling} style={s.bare}>
          <EmptyState
            icon="Sparkles"
            title={t("unavailable")}
            body={t("unavailableHint")}
            cta={t("card.generate")}
            onCta={() => generate.mutate()}
            ctaLoading={pending}
          />
        </fieldset>
        {pending && <BriefSkeleton />}
        {generateNotice}
      </div>
      {children}
    </Card>
    );
  }

  // Without the diff nothing could be assessed: an empty risk/focus list is not "no risks".
  const risksNotAssessed =
    brief.meta.missing.includes("diff") && brief.risks.risks.length === 0;

  const { cost, tokensIn, tokensOut } = costTokensParts(brief.meta);
  const costText = formatCost(cost);
  const visible: string[] = [];
  const spoken: string[] = [];
  if (costText !== null) {
    visible.push(costText);
    spoken.push(t("card.costTokensCost", { cost: costText }));
  }
  if (tokensIn !== null && tokensOut !== null) {
    visible.push(`${formatTokens(tokensIn)}${TOKENS_ARROW}${formatTokens(tokensOut)}`);
  } else if (tokensIn !== null) {
    visible.push(`${formatTokens(tokensIn)} ${t("card.costTokensInWord")}`);
  } else if (tokensOut !== null) {
    visible.push(`${formatTokens(tokensOut)} ${t("card.costTokensOutWord")}`);
  }
  if (tokensIn !== null) spoken.push(t("card.costTokensIn", { count: tokensIn }));
  if (tokensOut !== null) spoken.push(t("card.costTokensOut", { count: tokensOut }));
  const costTokensLabel = t("card.costTokens", { parts: spoken.join(", ") });
  const costTokens =
    visible.length > 0 ? (
      <span role="note" aria-label={costTokensLabel} title={costTokensLabel} style={s.costTokens}>
        {visible.join(" ")}
      </span>
    ) : null;

  return (
    <Card style={s.wrap}>
      <div aria-busy={pending} style={pending ? s.dimmed : undefined}>
      <div style={s.header}>
        {title}
        {brief.stale && (
          <span role="status" style={s.staleBadge}>
            {t("card.stale")}
          </span>
        )}
        <span style={s.generatedAt}>
          {t("card.generatedAt", {
            when: new Date(brief.meta.generated_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </span>
        {costTokens}
        <div style={s.headerActions}>
          <Button
            size="sm"
            kind="ghost"
            icon="RefreshCw"
            disabled={pending || cooling}
            onClick={() => generate.mutate()}
          >
            {pending ? t("card.regenerating") : t("card.regenerate")}
          </Button>
        </div>
      </div>

      {brief.meta.missing.length > 0 && (
        <div role="status" style={s.notice}>
          {t("card.missing", {
            list: missingLabels(brief.meta.missing, (m) => t(`missingInput.${m}`)).join(", "),
          })}
        </div>
      )}

      {notice}

      <BriefStats stats={brief.meta.diff_stats} sources={brief.meta.sources} />

      <div style={s.sectionLabel}>{t("card.summary")}</div>
      <p style={s.summary}>{brief.summary}</p>

      <div style={s.sectionLabel}>{t("block.risks")}</div>
      {risksNotAssessed ? (
        <p role="status" style={s.muted}>
          {t("card.risksNotAssessed")}
        </p>
      ) : (
        <RiskList risks={brief.risks.risks} onOpenRef={navigate} />
      )}

      {!(risksNotAssessed && brief.review_focus.length === 0) && (
        <>
          <div style={s.sectionLabel}>{t("card.reviewFocus")}</div>
          <ReviewFocusList items={brief.review_focus} onOpen={navigate} />
        </>
      )}

      {generateNotice}
    </div>
    {children}
    </Card>
  );
}
