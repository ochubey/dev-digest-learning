/* SyncBanner — shown above the PR list when the last GitHub sync failed, so a bad
   token doesn't look like "this repo has no pull requests". */
"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { RepoSyncStatus } from "@/lib/hooks";
import { s } from "./styles";

export function SyncBanner({ sync }: { sync: RepoSyncStatus | undefined }) {
  const t = useTranslations("prReview");
  if (!sync || sync.ok) return null;
  const reason = sync.reason ?? "error";
  const tokenProblem = reason === "bad_credentials" || reason === "no_token";
  return (
    <div data-testid="sync-banner" role="alert" style={s.wrap}>
      <Icon.AlertTriangle size={16} style={s.icon} />
      <div style={s.body}>
        <div style={s.title}>{t("list.sync.title")}</div>
        <div>{t(`list.sync.${reason}`)}</div>
        {sync.message && reason === "error" && <div style={s.detail}>{sync.message}</div>}
        <div style={s.detail}>{t("list.sync.showingSaved")}</div>
        {tokenProblem && (
          <Link href="/settings/api-keys" style={s.link}>
            {t("list.sync.settings")}
          </Link>
        )}
      </div>
    </div>
  );
}
