/* Multi-Agent Review — /repos/:repoId/multi-agent[?pr=<number>&agents=<ids>].
   Without `pr`/`agents` it opens the latest run's results (Configure run when there is none). */
"use client";

import React from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useLatestMultiAgentRun } from "@/lib/hooks/multi-agent";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ConfigureRun } from "./_components/ConfigureRun";
import { MultiAgentResults } from "./_components/MultiAgentResults";

export default function MultiAgentPage() {
  const t = useTranslations("multiAgent");
  const { repoId } = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const configuring = search.has("pr") || search.has("agents");
  const latest = useLatestMultiAgentRun(configuring || repoNotFound ? null : repoId);
  const latestId = !configuring && !latest.isError ? (latest.data?.id ?? null) : null;
  const loading = !configuring && !repoNotFound && latest.isLoading;
  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true },
    { label: latestId ? t("results.title") : t("configure.title") },
  ];

  return (
    <AppShell crumb={crumb}>
      {repoNotFound ? (
        <RepoNotFound />
      ) : loading ? (
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16 }} data-testid="latest-skeleton">
          <Skeleton height={28} width={320} />
          <Skeleton height={220} />
        </div>
      ) : latestId ? (
        <MultiAgentResults repoId={repoId} id={latestId} />
      ) : (
        <ConfigureRun repoId={repoId} />
      )}
    </AppShell>
  );
}
