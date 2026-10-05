/* Small Smart Diff pieces rendered by FileCard. They own their i18n lookup so a
   FileCard without findings does not need the prReview namespace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, type Severity } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { fs, knownSeverity } from "../findings";
import { SmartFindingCard } from "./SmartFindingCard";

/** Number-less dot in the file header; colour = highest severity in the file. */
export function FileFindingsDot({ severity }: { severity: Severity }) {
  const t = useTranslations("prReview");
  const label = t("smartDiff.fileHasFindings");
  return (
    <span
      data-testid="file-findings-dot"
      role="img"
      aria-label={label}
      title={label}
      style={fs.dot(SEV[severity].c)}
    />
  );
}

/** Findings whose line is not in the rendered patch, at the end of the file body. */
export function UnmatchedFindings({
  findings,
  prId,
}: {
  findings: FindingRecord[];
  prId: string | null;
}) {
  const t = useTranslations("prReview");
  if (findings.length === 0) return null;
  return (
    <div data-testid="unmatched-findings" style={fs.unmatchedWrap}>
      <span style={fs.unmatchedTitle}>{t("smartDiff.unmatchedFindings")}</span>
      {findings.map((f) => (
        <SmartFindingCard key={f.id} finding={f} prId={prId} />
      ))}
    </div>
  );
}

const SUMMARY_SEVERITIES: readonly Severity[] = ["CRITICAL", "WARNING"];

/** File header: the top-severity dot plus an icon + count per blocker / warning. */
export function FileFindingsSummary({
  findings,
  severity,
}: {
  findings: readonly FindingRecord[];
  severity: Severity;
}) {
  const t = useTranslations("prReview");
  return (
    <>
      <FileFindingsDot severity={severity} />
      {SUMMARY_SEVERITIES.map((sev) => {
        const n = findings.filter((f) => knownSeverity(f.severity) === sev).length;
        if (n === 0) return null;
        const SevIcon = Icon[SEV[sev].icon];
        const label = t("smartDiff.fileFindings", { count: n });
        return (
          <span
            key={sev}
            data-testid="file-findings-count"
            data-severity={sev}
            title={label}
            aria-label={label}
            style={fs.countChip(SEV[sev].c)}
          >
            <SevIcon size={13} />
            {n}
          </span>
        );
      })}
    </>
  );
}
