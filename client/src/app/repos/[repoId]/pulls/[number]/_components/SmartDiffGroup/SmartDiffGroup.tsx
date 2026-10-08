/* SmartDiffGroup — one role group of the Smart Diff: a collapsible header (colour
   square, role label + description, files-with-findings badge, file count, expand/collapse-all
   files button) and a DiffViewer body for the group's files. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, SEV, type Severity } from "@devdigest/ui";
import type { PrFile, SmartDiffRole } from "@devdigest/shared";
import { DiffViewer, type DiffCommentApi, type DiffFindingsApi } from "@/components/diff-viewer";
import { COLLAPSED_BY_DEFAULT, ROLE_COLOR } from "../DiffTab/constants";
import type { SeverityCounts } from "../DiffTab/helpers";
import { s, chevronStyle } from "./styles";

interface SmartDiffGroupProps {
  role: SmartDiffRole;
  files: PrFile[];
  commenting?: DiffCommentApi;
  findings?: DiffFindingsApi;
  /** Number of files in the group that have findings. */
  findingFiles?: number;
  /** Findings in the group by severity; only used to colour the badge by the top severity. */
  findingCounts?: SeverityCounts;
}

const SEVERITIES: readonly Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

export function SmartDiffGroup({
  role,
  files,
  commenting,
  findings,
  findingFiles = 0,
  findingCounts,
}: SmartDiffGroupProps) {
  const t = useTranslations("prReview");
  const empty = files.length === 0;
  const topSev = findingCounts ? SEVERITIES.find((sev) => findingCounts[sev as keyof SeverityCounts] > 0) : undefined;
  const [open, setOpen] = React.useState(!empty && !COLLAPSED_BY_DEFAULT.has(role));
  // Files start collapsed; the button toggles them all. `version` remounts the viewer so
  // every FileCard picks up the new default.
  const [filesOpen, setFilesOpen] = React.useState(false);
  const [version, setVersion] = React.useState(0);
  const toggleFiles = () => {
    setFilesOpen((v) => !v);
    setVersion((v) => v + 1);
  };

  return (
    <div data-testid="smart-diff-group" data-role={role} data-empty={empty || undefined} style={s.group(empty)}>
      <div style={s.headerRow}>
        <button
          type="button"
          data-testid="smart-diff-group-header"
          aria-expanded={open && !empty}
          disabled={empty}
          onClick={() => setOpen((o) => !o)}
          style={s.header}
        >
          <Icon.ChevronRight size={13} style={chevronStyle(open && !empty)} />
          <span data-testid="group-color" style={s.swatch(ROLE_COLOR[role])} />
          <span>{t(`smartDiff.${role}Label`)}</span>
          <span style={s.description}>{t(`smartDiff.${role}Description`)}</span>
        </button>
        {findingFiles > 0 && topSev && (
          <span
            data-testid="group-findings-dot"
            data-severity={topSev}
            role="img"
            aria-label={t("smartDiff.filesWithFindings", { count: findingFiles })}
            title={t("smartDiff.filesWithFindings", { count: findingFiles })}
            style={s.findingsBadge}
          >
            <span style={s.findingsDot(SEV[topSev].c)} />
            {findingFiles}
          </span>
        )}
        <span style={s.count}>{t("smartDiff.filesCount", { count: files.length })}</span>
        {!empty && (
          <button
            type="button"
            data-testid="group-toggle-files"
            aria-label={filesOpen ? t("smartDiff.collapseFiles") : t("smartDiff.expandFiles")}
            title={filesOpen ? t("smartDiff.collapseFiles") : t("smartDiff.expandFiles")}
            onClick={toggleFiles}
            style={s.toggleFiles}
          >
            <Icon.ChevronsUpDown size={14} />
          </button>
        )}
      </div>
      {open && !empty && (
        <DiffViewer
          key={version}
          files={files}
          defaultOpen={filesOpen}
          commenting={commenting}
          findings={findings}
        />
      )}
    </div>
  );
}
