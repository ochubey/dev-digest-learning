/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { isInScope, isVisibleScope } from "@/lib/latest-findings";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  severityFilter = null,
  onVisibleCountChange,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** Page-level severity filter (from SeverityCountBadges), ANDed with hideLow. */
  severityFilter?: Severity | null;
  /** Reports the post-filter count (severityFilter + hideLow) so an ancestor
   *  (e.g. ReviewRunAccordion's header) can stay in sync with what's actually
   *  shown here, instead of re-deriving a partial count itself. */
  onVisibleCountChange?: (count: number) => void;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const [hideLow, setHideLow] = React.useState(false);
  const [showOut, setShowOut] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, severityFilter, showOut),
    [findings, hideLow, severityFilter, showOut],
  );
  // Out-of-scope findings suppressed by the scope policy (dismissed ones don't count).
  const hiddenCount = React.useMemo(
    () => findings.filter((f) => !isVisibleScope(f.scope) && !f.dismissed_at).length,
    [findings],
  );
  // Reported count = what the run's verdict numbers mean: in-scope findings only
  // (revealed `out` cards and the separate `signal` are not part of it).
  const reportedCount = React.useMemo(
    () => shown.filter((f) => isInScope(f.scope)).length,
    [shown],
  );

  React.useEffect(() => {
    onVisibleCountChange?.(reportedCount);
  }, [reportedCount, onVisibleCountChange]);

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        {hiddenCount > 0 && (
          <>
            <span data-testid="scope-suppressed" style={s.hiddenCounter}>
              {t("scope.suppressed", { count: hiddenCount })}
            </span>
            <label style={s.revealGroup}>
              {showOut ? t("scope.conceal") : t("scope.reveal")}
              <Toggle on={showOut} onChange={setShowOut} size={16} />
            </label>
          </>
        )}
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              muted={f.scope === "out"}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
            />
          ))
        )}
      </div>
    </div>
  );
}
