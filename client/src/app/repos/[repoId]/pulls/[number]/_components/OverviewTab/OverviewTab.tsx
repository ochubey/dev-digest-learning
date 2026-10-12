"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel } from "@devdigest/ui";
import type { ReviewRecord, Verdict } from "@devdigest/shared";
import { usePrBrief } from "@/lib/hooks/brief";
import { isInScope } from "@/lib/latest-findings";
import { IntentBlock } from "../IntentBlock";
import { BlastRadiusBlock } from "../BlastRadiusBlock";
import { PrBriefCard, InputsChangedHint } from "../PrBriefCard";
import { VerdictBanner } from "../VerdictBanner";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string;
  prBody: string | null | undefined;
  repoId?: string | null;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Paths present in this PR diff. */
  diffPaths: Set<string>;
  onOpenInDiff: (file: string, line: number | null) => void;
  /** Newest run with kind === "review"; null when the PR has none. */
  latestReview: ReviewRecord | null;
}

export function OverviewTab({
  prId,
  prBody,
  repoId,
  repoFullName,
  headSha,
  diffPaths,
  onOpenInDiff,
  latestReview,
}: OverviewTabProps) {
  const t = useTranslations("brief");
  // Observed here (stable mount) so the hint, rendered inside the card, never re-subscribes.
  const { data: briefData, error: briefError } = usePrBrief(prId);
  const brief = briefError ? undefined : briefData;
  // Same numbers as the Agent runs accordion: in-scope findings, undismissed CRITICAL blockers.
  const inScope = latestReview?.findings.filter((f) => isInScope(f.scope)) ?? [];
  const blockers = inScope.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;

  return (
    <>
      {latestReview?.verdict && (
        <VerdictBanner
          verdict={latestReview.verdict as Verdict}
          summary={latestReview.summary}
          score={latestReview.score}
          findingsCount={inScope.length}
          blockers={blockers}
          agentName={latestReview.agent_name}
        />
      )}
      <PrBriefCard
        prId={prId}
        diffPaths={diffPaths}
        onOpenInDiff={onOpenInDiff}
        notice={brief && <InputsChangedHint prId={prId} brief={brief} />}
      >
        <IntentBlock prId={prId} />
        <BlastRadiusBlock
          prId={prId}
          repoId={repoId}
          repoFullName={repoFullName}
          headSha={headSha}
        />
      </PrBriefCard>
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">{t("overview.description")}</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
