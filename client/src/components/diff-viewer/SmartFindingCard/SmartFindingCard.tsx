/* SmartFindingCard — simplified finding for the Files changed tab: coloured left
   stripe, severity icon, title, right-aligned blocker/warning/suggestion label,
   markdown rationale and Accept / Dismiss. The full FindingCard is untouched. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, Markdown, SEV } from "@devdigest/ui";
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
      <div style={fs.prose}>
        <Markdown>{finding.rationale}</Markdown>
      </div>
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
