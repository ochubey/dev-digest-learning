"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { CiExport } from "@devdigest/shared";
import { safeGithubUrl, secretsSettingsUrl } from "../../../helpers";
import { s } from "../../styles";

export type InstallAction = "open_pr" | "files";

export interface InstallStepProps {
  repo: string;
  /** The export request in flight: both options are disabled while it runs (AC-50). */
  pendingAction: InstallAction | null;
  onInstall: (action: InstallAction) => void;
  /** Success state: the export response. */
  result: CiExport | null;
  error: string | null;
  /** Re-run the last failed action. */
  onRetry: (() => void) | null;
}

/** Step 4: open a PR or download a zip, then show the success state (AC-36, AC-41, AC-43, AC-45, AC-50). */
export function InstallStep({ repo, pendingAction, onInstall, result, error, onRetry }: InstallStepProps) {
  const t = useTranslations("ciExport.install");
  const pending = pendingAction !== null;

  if (result) {
    const prUrl = safeGithubUrl(result.pr_url);
    return (
      <>
        <p style={s.heading} role="status">
          {prUrl ? t("successPr") : t("successZip")}
        </p>
        {prUrl && (
          <a href={prUrl} target="_blank" rel="noopener noreferrer" style={s.link}>
            {t("viewPr")}
          </a>
        )}
        <div style={s.note}>
          <strong>{t("secretTitle")}</strong>
          <p style={{ margin: "6px 0" }}>{t("secretBody")}</p>
          <a href={secretsSettingsUrl(repo)} target="_blank" rel="noopener noreferrer" style={s.link}>
            {t("secretLink")}
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <h3 style={s.heading}>{t("heading")}</h3>
      <button
        type="button"
        style={{ ...s.card, ...s.cardActive, cursor: pending ? "default" : "pointer" }}
        disabled={pending}
        onClick={() => onInstall("open_pr")}
      >
        <span style={s.cardTitle}>
          <Icon.GitPullRequest size={18} />
          {t("openPr")}
        </span>
        <p style={{ ...s.hint, marginTop: 8 }}>{t("openPrDesc")}</p>
      </button>
      <button
        type="button"
        style={{ ...s.card, cursor: pending ? "default" : "pointer" }}
        disabled={pending}
        onClick={() => onInstall("files")}
      >
        <span style={s.cardTitle}>
          <Icon.Copy size={16} />
          {t("zip")}
        </span>
        <p style={{ ...s.hint, marginTop: 8 }}>{t("zipDesc")}</p>
      </button>
      {pending && (
        <p style={s.hint} role="status">
          {t("working")}
        </p>
      )}
      {error && (
        <div role="alert">
          <p style={s.error}>{error}</p>
          {onRetry && !pending && (
            <Button size="sm" onClick={onRetry}>
              {t("tryAgain")}
            </Button>
          )}
        </div>
      )}
    </>
  );
}
