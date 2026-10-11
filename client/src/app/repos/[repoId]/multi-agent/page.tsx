/* Configure run — /repos/:repoId/multi-agent?pr=<number>&agents=<ids>. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ConfigureRun } from "./_components/ConfigureRun";

export default function MultiAgentPage() {
  const t = useTranslations("multiAgent");
  const { repoId } = useParams<{ repoId: string }>();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true },
    { label: t("configure.title") },
  ];

  return (
    <AppShell crumb={crumb}>{repoNotFound ? <RepoNotFound /> : <ConfigureRun repoId={repoId} />}</AppShell>
  );
}
