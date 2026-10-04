/* SmartFindingCard — simplified finding for the Files changed tab: coloured left
   stripe, severity icon, title, right-aligned blocker/warning/suggestion label,
   markdown rationale and Accept / Dismiss. The full FindingCard is untouched. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, Markdown, SEV, CAT } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { useFindingAction } from "@/lib/hooks/reviews";
import { fs, knownSeverity, severityLabel } from "../findings";

export function SmartFindingCard({
  finding,
  prId,
}: {
  finding: FindingRecord;
  prId: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const sev = SEV[knownSeverity(finding.severity)];
  const SevIcon = Icon[sev.icon];
  const accepted = !!finding.accepted_at;
  const dismissed = !!finding.dismissed_at;
  const run = (kind: "accept" | "dismiss") =>
    action.mutate({ findingId: finding.id, action: kind, ...(prId ? { prId } : {}) });

  return (
    <div
      data-testid="smart-finding-card"
      data-finding-id={finding.id}
      style={fs.card(sev.c, accepted || dismissed)}
    >
      <div style={fs.head}>
        <SevIcon size={14} style={{ color: sev.c, flexShrink: 0 }} />
        <span style={fs.title(dismissed)}>{finding.title}</span>
        {accepted && <span style={fs.tag}>{t("finding.accepted")}</span>}
        {dismissed && <span style={fs.tag}>{t("finding.dismissed")}</span>}
        {finding.scope === "signal" && <span style={fs.signalTag}>{t("scope.signal")}</span>}
        {finding.category && (
          <span data-testid="smart-finding-category" style={fs.category}>
            {CAT[finding.category as keyof typeof CAT]?.label ?? finding.category}
          </span>
        )}
        <span data-testid="smart-finding-label" style={fs.label(sev.c)}>
          {t(`smartDiff.severity.${severityLabel(finding.severity)}`)}
        </span>
      </div>
      {/* scope_reason is model output: plain text only, never Markdown/HTML. */}
      {finding.scope === "signal" && finding.scope_reason && (
        <div data-testid="finding-scope-reason" style={fs.scopeReason}>
          {finding.scope_reason}
        </div>
      )}
      <div data-testid="smart-finding-meta" className="mono" style={fs.meta}>
        {finding.file}:{finding.start_line}
        {finding.end_line !== finding.start_line ? `-${finding.end_line}` : ""}
        <span style={fs.confidence(finding.confidence)}>
          {t("smartDiff.confidence", { pct: Math.round(finding.confidence * 100) })}
        </span>
      </div>
      <div style={fs.prose}>
        <Markdown>{finding.rationale}</Markdown>
      </div>
      {finding.suggestion && (
        <div data-testid="smart-finding-fix">
          <div style={fs.fixLabel}>{t("smartDiff.suggestedFix")}</div>
          <div style={fs.prose}>
            <Markdown>{finding.suggestion}</Markdown>
          </div>
        </div>
      )}
      <div style={fs.actions}>
        <Button
          kind="secondary"
          size="sm"
          icon="Check"
          disabled={action.isPending}
          active={accepted}
          onClick={() => run("accept")}
        >
          {t("finding.accept")}
        </Button>
        <Button
          kind="ghost"
          size="sm"
          icon="X"
          disabled={action.isPending}
          active={dismissed}
          onClick={() => run("dismiss")}
        >
          {t("finding.dismiss")}
        </Button>
      </div>
    </div>
  );
}
