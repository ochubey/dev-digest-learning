"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon } from "@devdigest/ui";
import type { CiFile } from "@devdigest/shared";
import { formatBytes, isWorkflowPath } from "../../../helpers";
import { s } from "../../styles";

export interface PreviewStepProps {
  files: CiFile[];
  runnerVersion: string;
  selectedPath: string;
  onSelect: (path: string) => void;
  /** The user's edit of the workflow file, or null when untouched. */
  workflowEdit: string | null;
  onEdit: (text: string | null) => void;
  regenerating: boolean;
  /** AC-35: Configure values changed while the workflow has edits. */
  askRegenerate: boolean;
  onConfirmRegenerate: () => void;
  onCancelRegenerate: () => void;
  error: string | null;
}

/** Step 2: the generated files. Only the workflow is editable; the runner shows size + version (AC-11, AC-12). */
export function PreviewStep(p: PreviewStepProps) {
  const t = useTranslations("ciExport.preview");
  const file = p.files.find((f) => f.path === p.selectedPath) ?? p.files[0];
  // Only the agent's own workflow is editable; a legacy workflow regenerated for another agent is read-only.
  const editable = !!file && file.editable && isWorkflowPath(file.path);
  const isRunner = !!file && file.size_bytes != null && file.contents === "";

  return (
    <>
      {p.error && (
        <p style={s.error} role="alert">
          {p.error}
        </p>
      )}
      {p.askRegenerate && (
        <div style={s.confirm} role="group" aria-label={t("confirmRegenerate")}>
          <span>{t("confirmRegenerate")}</span>
          <Button kind="primary" size="sm" onClick={p.onConfirmRegenerate}>
            {t("confirmYes")}
          </Button>
          <Button size="sm" onClick={p.onCancelRegenerate}>
            {t("confirmNo")}
          </Button>
        </div>
      )}
      {p.regenerating && (
        <p style={s.hint} role="status">
          {t("regenerating")}
        </p>
      )}
      <div style={s.files}>
        <div style={s.fileList} role="listbox" aria-label={t("filesTitle")}>
          <div style={s.fileListTitle}>{t("filesTitle")}</div>
          {p.files.map((f) => {
            const active = f.path === file?.path;
            return (
              <button
                key={f.path}
                type="button"
                role="option"
                aria-selected={active}
                style={{ ...s.fileBtn, ...(active ? s.fileBtnActive : null) }}
                onClick={() => p.onSelect(f.path)}
              >
                <Icon.FileText size={13} />
                {f.path}
              </button>
            );
          })}
        </div>
        {file && (
          <div style={s.viewer}>
            <div style={s.viewerHead}>
              <span style={s.viewerPath}>{file.path}</span>
              {editable && <Badge icon="Edit" color="var(--text-muted)">{t("editable")}</Badge>}
              {!editable && !isRunner && <Badge color="var(--text-muted)">{t("readOnly")}</Badge>}
            </div>
            {isRunner ? (
              <p style={{ ...s.hint, padding: 14 }}>
                {t("runnerInfo", { size: formatBytes(file.size_bytes), version: p.runnerVersion })}
              </p>
            ) : editable ? (
              <textarea
                aria-label={t("editLabel", { path: file.path })}
                style={s.code}
                spellCheck={false}
                value={p.workflowEdit ?? file.contents}
                onChange={(e) => p.onEdit(e.target.value === file.contents ? null : e.target.value)}
              />
            ) : (
              <pre style={s.code}>{file.contents}</pre>
            )}
          </div>
        )}
      </div>
    </>
  );
}
