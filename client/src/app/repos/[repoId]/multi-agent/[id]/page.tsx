/* Multi-agent results — /repos/:repoId/multi-agent/:id?view=columns|tabs. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { MultiAgentResults } from "../_components/MultiAgentResults";

export default function MultiAgentResultsPage() {
  const t = useTranslations("multiAgent");
  const { repoId, id } = useParams<{ repoId: string; id: string }>();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const crumb = [
    { label: activeRepo?.full_name ?? repoId, mono: true },
    { label: t("results.title") },
  ];

  return (
    <AppShell crumb={crumb}>
      {repoNotFound ? <RepoNotFound /> : <MultiAgentResults repoId={repoId} id={id} />}
    </AppShell>
  );
}
