"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Icon, Skeleton } from "@devdigest/ui";
import type { CiSyncResult } from "@devdigest/shared";
import { CiRunsTable, formatTime } from "@/components/ci-export";
import { PageContainer } from "@/components/page-shell";
import { useCiRuns, useCiSync } from "@/lib/hooks/ci";
import { s } from "./styles";

/** CI Runs page: stored runs at once, one sync on open, manual Refresh (AC-71..AC-79). */
export function CiRunsView() {
  const t = useTranslations("ciRuns.page");
  const runs = useCiRuns();
  const sync = useCiSync();
  const [lastSync, setLastSync] = React.useState<CiSyncResult | null>(null);

  const refresh = React.useCallback(() => {
    sync.mutate(undefined, { onSuccess: setLastSync });
  }, [sync]);

  // One sync on mount; the ref keeps StrictMode's double effect from firing two.
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    refresh();
  }, [refresh]);

  const data = runs.data;
  const failures = lastSync?.failures ?? [];

  return (
    <PageContainer
      title={t("title")}
      subtitle={t("subtitle")}
      actions={
        <>
          {lastSync && <span style={s.synced}>{t("lastSynced", { time: formatTime(lastSync.synced_at) })}</span>}
          <Button size="sm" icon="RefreshCw" loading={sync.isPending} disabled={sync.isPending} onClick={refresh}>
            {t("refresh")}
          </Button>
        </>
      }
    >
      <div style={s.wrap}>
        {failures.length > 0 && (
          <div style={s.warning} role="alert">
            <p style={s.warningTitle}>{t("failuresTitle")}</p>
            <ul style={s.warningList}>
              {failures.map((f, i) => (
                <li key={`${f.repo}-${i}`}>{t("failureItem", { repo: f.repo, message: f.message })}</li>
              ))}
            </ul>
          </div>
        )}
        {sync.isError && (
          <p style={s.error} role="alert">
            {t("syncFailed", { message: sync.error.message })}
          </p>
        )}

        {runs.isLoading ? (
          <div style={s.skeleton} role="status" aria-label={t("loading")}>
            <Skeleton height={36} />
            <Skeleton height={36} />
            <Skeleton height={36} />
          </div>
        ) : runs.isError || !data ? (
          <div style={s.empty} role="alert">
            <p style={s.emptyTitle}>{t("errorTitle")}</p>
            <p style={s.emptyText}>{t("errorBody")}</p>
            <Button icon="RefreshCw" onClick={() => void runs.refetch()}>
              {t("tryAgain")}
            </Button>
          </div>
        ) : data.runs.length === 0 ? (
          <div style={s.empty}>
            <Icon.Workflow size={28} />
            <p style={s.emptyText}>
              {data.installations_count === 0 ? t("emptyNoInstallations") : t("emptyWithInstallations")}
            </p>
            {data.installations_count === 0 && (
              <Link href="/agents" style={s.link}>
                {t("setUp")}
              </Link>
            )}
          </div>
        ) : (
          <CiRunsTable runs={data.runs} showAgent />
        )}
      </div>
    </PageContainer>
  );
}
