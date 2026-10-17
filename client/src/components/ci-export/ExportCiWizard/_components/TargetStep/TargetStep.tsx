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

/** Other CI targets from the design: shown disabled until a generator exists (GitHub Actions is the only real one). */
const COMING_SOON = [
  { key: "circleci", icon: "RefreshCw", title: "circleci", desc: "circleciDesc" },
  { key: "jenkins", icon: "Settings", title: "jenkins", desc: "jenkinsDesc" },
  { key: "cli", icon: "Command", title: "cli", desc: "cliDesc" },
] as const;

/** Step 1: GitHub Actions is the only working target (the others are disabled placeholders); pick one connected repository (AC-3..AC-8). */
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

      <div style={s.cardGrid}>
        {COMING_SOON.map((c) => {
          const I = Icon[c.icon];
          return (
            <button key={c.key} type="button" disabled aria-disabled="true" style={{ ...s.card, ...s.cardDisabled }}>
              <span style={s.cardTitle}>
                <I size={16} />
                {t(c.title)}
              </span>
              <p style={{ ...s.hint, marginTop: 6 }}>{t(c.desc)}</p>
              <Badge color="var(--text-muted)" bg="var(--bg-elevated)" style={{ marginTop: 6 }}>
                {t("comingSoon")}
              </Badge>
            </button>
          );
        })}
      </div>

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
