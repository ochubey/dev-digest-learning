"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi, type DiffFindingsApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment, usePrReviews } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { latestFindingsPerAgent, hiddenByScope } from "@/lib/latest-findings";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { SmartDiffGroup } from "../SmartDiffGroup";
import { SmartDiffToggle } from "../SmartDiffToggle";
import { groupFiles, withEmptyRoles } from "./helpers";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Two independent switches: GitHub comments, and inline finding cards (dots/counters stay).
  const [showComments, setShowComments] = React.useState(true);
  const [showFindings, setShowFindings] = React.useState(true);

  const { data: smartDiff, isError: smartDiffFailed } = useSmartDiff(prId);
  // On (default) = flat list in GitHub order; off = grouped by role (Smart order).
  const [originalOrder, setOriginalOrder] = React.useState(true);

  // Smart Diff findings: ONE visible list (lib/latest-findings.ts) drives the group
  // counters, the file dots and the inline cards.
  const { data: reviews } = usePrReviews(prId);
  // Only findings on files that are part of this PR: others are never rendered, so they
  // must not inflate the button count or its visibility.
  const findingItems = React.useMemo(() => {
    const paths = new Set(files.map((f) => f.path));
    return latestFindingsPerAgent(reviews).filter((f) => paths.has(f.file));
  }, [reviews, files]);
  // Out-of-scope findings (never rendered): only a passive count for the hint below.
  const hiddenCount = React.useMemo(() => {
    const paths = new Set(files.map((f) => f.path));
    return hiddenByScope(reviews).filter((f) => paths.has(f.file)).length;
  }, [reviews, files]);
  const findings: DiffFindingsApi = { items: findingItems, show: showFindings, prId };
  const reviewNotRun = !!reviews && !reviews.some((r) => r.kind === "review");

  const commentCount = comments?.length ?? 0;
  // While smart-diff is loading or failed `smartDiff` is undefined -> flat list.
  const groups = React.useMemo(
    () => (smartDiff ? withEmptyRoles(groupFiles(files, smartDiff, findingItems)) : null),
    [files, smartDiff, findingItems],
  );

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          <div style={{ display: "flex", gap: 6 }}>
            {groups && <SmartDiffToggle originalOrder={originalOrder} onChange={setOriginalOrder} />}
            {findingItems.length > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showFindings ? "EyeOff" : "Eye"}
                onClick={() => setShowFindings((v) => !v)}
              >
                {showFindings
                  ? t("smartDiff.hideFindings", { count: findingItems.length })
                  : t("smartDiff.showFindings", { count: findingItems.length })}
              </Button>
            )}
            {commentCount > 0 && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments
                  ? t("smartDiff.hideComments", { count: commentCount })
                  : t("smartDiff.showComments", { count: commentCount })}
              </Button>
            )}
          </div>
        }
      >
        {t("smartDiff.filesChanged", { count: filesCount })}
      </SectionLabel>
      {reviewNotRun && (
        <div
          data-testid="review-not-run"
          role="status"
          style={{
            margin: "0 0 10px",
            padding: "10px 12px",
            fontSize: 13,
            color: "var(--text-muted)",
            border: "1px dashed var(--border)",
            borderRadius: 6,
          }}
        >
          {t("smartDiff.reviewNotRun")}
        </div>
      )}
      {hiddenCount > 0 && (
        <div
          data-testid="out-of-scope-hint"
          role="status"
          style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-muted)" }}
        >
          {t("smartDiff.outOfScopeHidden", { count: hiddenCount })}
        </div>
      )}
      {smartDiffFailed && !smartDiff && (
        <div data-testid="grouping-unavailable" role="status" style={{ margin: "0 0 10px", fontSize: 13, color: "var(--text-muted)" }}>
          {t("smartDiff.groupingUnavailable")}
        </div>
      )}
      {groups && !originalOrder ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {groups.map((g) => (
            <SmartDiffGroup
              key={g.role}
              role={g.role}
              files={g.files}
              findingFiles={g.findingFiles}
              findingCounts={g.findingCounts}
              commenting={commenting}
              findings={findings}
            />
          ))}
        </div>
      ) : (
        <DiffViewer files={files} commenting={commenting} findings={findings} />
      )}
    </section>
  );
}
