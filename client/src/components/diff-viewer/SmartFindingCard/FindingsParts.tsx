/* Small Smart Diff pieces rendered by FileCard. They own their i18n lookup so a
   FileCard without findings does not need the prReview namespace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SEV, type Severity } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { fs } from "../findings";
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
