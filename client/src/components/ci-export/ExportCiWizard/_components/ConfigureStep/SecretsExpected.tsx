"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import { useCiSecretStatus } from "@/lib/hooks/ci";
import { safeGithubUrl, secretsSettingsUrl } from "../../../helpers";
import { SECRET_BADGE } from "./constants";
import { secretsStyles as ss } from "./styles";
import { s } from "../../styles";

export interface SecretsExpectedProps {
  /** Selected repository id; the status is only fetched once it is set. */
  repoId: string | null;
  /** owner/name of the selected repository, for the Actions secrets link. */
  repo: string;
}

/** Informational "Secrets expected" box. Never blocks Continue; shows a secret's state, never its value. */
export function SecretsExpected({ repoId, repo }: SecretsExpectedProps) {
  const t = useTranslations("ciExport.configure.secrets");
  const status = useCiSecretStatus(repoId);
  const state = status.isError ? "unknown" : status.data ? status.data.OPENROUTER_API_KEY : "checking";
  const badge = SECRET_BADGE[state];
  const href = repo ? safeGithubUrl(secretsSettingsUrl(repo)) : null;
  const showLink = (state === "not_set" || state === "unknown") && !!href;
  return (
    <section style={ss.box} aria-label={t("title")} data-testid="ci-secrets-expected">
      <h4 style={ss.title}>{t("title")}</h4>
      <div style={ss.row}>
        <code style={ss.name}>OPENROUTER_API_KEY</code>
        <span style={ss.desc}>{t("openrouterDesc")}</span>
        <span style={ss.right}>
          {showLink && (
            <a href={href ?? undefined} target="_blank" rel="noopener noreferrer" style={s.link}>
              {t("addLink")}
            </a>
          )}
          <Badge color={badge.color} bg={badge.bg}>
            {t(badge.key)}
          </Badge>
        </span>
      </div>
      <div style={ss.row}>
        <code style={ss.name}>GITHUB_TOKEN</code>
        <span style={ss.desc}>{t("githubDesc")}</span>
        <span style={ss.right}>
          <Badge color="var(--ok)" bg="var(--ok-bg, var(--bg-hover))">
            {t("ready")}
          </Badge>
        </span>
      </div>
      <p style={ss.footer}>{t("footer")}</p>
    </section>
  );
}
