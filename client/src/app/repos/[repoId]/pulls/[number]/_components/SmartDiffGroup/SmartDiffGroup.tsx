/* SmartDiffGroup — one role group of the Smart Diff: a collapsible header
   (role label + file count) and a DiffViewer body for the group's files. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile, SmartDiffRole } from "@devdigest/shared";
import { DiffViewer, type DiffCommentApi, type DiffFindingsApi } from "@/components/diff-viewer";
import { COLLAPSED_BY_DEFAULT } from "../DiffTab/constants";
import { s, chevronStyle } from "./styles";

interface SmartDiffGroupProps {
  role: SmartDiffRole;
  files: PrFile[];
  commenting?: DiffCommentApi;
  findings?: DiffFindingsApi;
  /** Number of files in the group that have findings (header dot). */
  findingFiles?: number;
}

export function SmartDiffGroup({ role, files, commenting, findings, findingFiles = 0 }: SmartDiffGroupProps) {
  const t = useTranslations("prReview");
  const collapsedByDefault = COLLAPSED_BY_DEFAULT.has(role);
  const [open, setOpen] = React.useState(!collapsedByDefault);

  return (
    <div data-testid="smart-diff-group" data-role={role} style={s.group}>
      <button
        type="button"
        data-testid="smart-diff-group-header"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={s.header}
      >
        <Icon.ChevronRight size={13} style={chevronStyle(open)} />
        <span>{t(`smartDiff.${role}Label`)}</span>
        {findingFiles > 0 && (
          <span
            data-testid="group-findings-dot"
            role="img"
            aria-label={t("smartDiff.filesWithFindings", { count: findingFiles })}
            title={t("smartDiff.filesWithFindings", { count: findingFiles })}
            style={s.findingsBadge}
          >
            <span style={s.findingsDot} />
            {findingFiles}
          </span>
        )}
        <span style={s.count}>{t("smartDiff.filesCount", { count: files.length })}</span>
      </button>
      {open && <DiffViewer files={files} commenting={commenting} findings={findings} />}
    </div>
  );
}
