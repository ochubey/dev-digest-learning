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
import { groupFiles } from "./helpers";

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
  // One switch for both GitHub comments and inline finding cards (dots/counters stay).
  const [showComments, setShowComments] = React.useState(true);

  const { data: smartDiff, isError: smartDiffFailed } = useSmartDiff(prId);
  // Off = grouped by role; on = flat list in GitHub order.
  const [originalOrder, setOriginalOrder] = React.useState(false);

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
  const findings: DiffFindingsApi = { items: findingItems, show: showComments, prId };

  const commentCount = comments?.length ?? 0;
  // While smart-diff is loading or failed `smartDiff` is undefined -> flat list.
  const groups = React.useMemo(
    () => (smartDiff ? groupFiles(files, smartDiff, findingItems) : null),
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
            {groups && (
              <SmartDiffToggle
                originalOrder={originalOrder}
                onToggle={() => setOriginalOrder((v) => !v)}
              />
            )}
            {(commentCount > 0 || findingItems.length > 0) && (
              <Button
                kind="ghost"
                size="sm"
                icon={showComments ? "EyeOff" : "Eye"}
                onClick={() => setShowComments((v) => !v)}
              >
                {showComments
                  ? t("smartDiff.hideComments", { count: commentCount + findingItems.length })
                  : t("smartDiff.showComments", { count: commentCount + findingItems.length })}
              </Button>
            )}
          </div>
        }
      >
        {t("smartDiff.filesChanged", { count: filesCount })}
      </SectionLabel>
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
