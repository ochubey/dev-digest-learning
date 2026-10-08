/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { type DiffFindingsApi } from "../findings";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  defaultOpen,
  findings,
  target,
  scrolledRef,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Forwarded to every FileCard; undefined keeps the auto-expand rule. */
  defaultOpen?: boolean;
  /** Smart Diff findings, forwarded to every FileCard. */
  findings?: DiffFindingsApi;
  /** Deep-link target: the matching file is forced open and scrolled to. */
  target?: { file: string; line: number | null } | null;
  /** Shared "already scrolled for this target" marker, forwarded to every FileCard. */
  scrolledRef?: React.MutableRefObject<string | null>;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f, i) => (
        <FileCard
          key={i}
          file={f}
          commenting={commenting}
          defaultOpen={defaultOpen}
          findings={findings}
          forceOpen={!!target && target.file === f.path}
          highlightLine={target && target.file === f.path ? target.line : null}
          scrolledRef={scrolledRef}
        />
      ))}
    </div>
  );
}
