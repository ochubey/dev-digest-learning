"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton } from "@devdigest/ui";
import type { Repo } from "@devdigest/shared";
import { s } from "../../styles";

export interface TargetStepProps {
  /** Connected repositories; undefined while loading. */
  repos: Repo[] | undefined;
  repo: string;
  onRepo: (fullName: string) => void;
  /** AC-7: the agent's provider is not OpenRouter. */
  unsupportedProvider: boolean;
  checking: boolean;
  error: string | null;
}

/** Step 1: GitHub Actions is the only target; pick one connected repository (AC-3..AC-8). */
export function TargetStep({ repos, repo, onRepo, unsupportedProvider, checking, error }: TargetStepProps) {
  const t = useTranslations("ciExport.target");
  return (
    <>
      <h3 style={s.heading}>{t("heading")}</h3>
      <button type="button" aria-pressed="true" style={{ ...s.card, ...s.cardActive }}>
        <span style={s.cardTitle}>
          <Icon.Workflow size={18} />
          {t("gha")}
          <Badge color="var(--accent-text)" bg="var(--bg-elevated)" style={{ marginLeft: "auto" }}>
            {t("recommended")}
          </Badge>
        </span>
        <p style={{ ...s.hint, marginTop: 8 }}>{t("ghaDesc")}</p>
      </button>

      {unsupportedProvider && (
        <p style={s.error} role="alert">
          {t("unsupportedProvider")}
        </p>
      )}

      {repos === undefined ? (
        <Skeleton height={64} />
      ) : repos.length === 0 ? (
        <p style={s.hint}>
          {t("noRepos")}.{" "}
          <Link href="/onboarding" style={s.link}>
            {t("noReposLink")}
          </Link>
        </p>
      ) : (
        <fieldset style={s.group}>
          <legend style={s.legend}>{t("repoLabel")}</legend>
          {repos.map((r) => (
            <label key={r.id} style={s.option}>
              <input
                type="radio"
                name="ci-repo"
                value={r.full_name}
                checked={repo === r.full_name}
                onChange={() => onRepo(r.full_name)}
              />
              {r.full_name}
            </label>
          ))}
        </fieldset>
      )}

      {checking && (
        <p style={s.hint} role="status">
          {t("checking")}
        </p>
      )}
      {error && (
        <p style={s.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}
