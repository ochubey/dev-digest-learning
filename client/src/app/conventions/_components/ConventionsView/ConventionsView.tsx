/* ConventionsView — repo-scoped extraction of coding conventions into
   reviewable candidates, then folded into a skill. Repo picker reuses the
   app-wide active-repo context (same repos list the sidebar's RepoSwitcher
   shows) rather than navigating away — this page's repo choice is local, it
   does not change the app's active repo. */
"use client";

import React from "react";
import { Button, EmptyState, ErrorState, Skeleton, SelectInput } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useActiveRepo } from "../../../../lib/repo-context";
import { useConventions, useExtractConventions } from "../../../../lib/hooks/conventions";
import { ConventionCard } from "./_components/ConventionCard";
import { CreateSkillModal } from "./_components/CreateSkillModal";
import { s } from "./styles";

export function ConventionsView() {
  const { repos, repoId: activeRepoId, reposLoaded } = useActiveRepo();
  const [repoId, setRepoId] = React.useState<string | null>(null);
  const [creatingSkill, setCreatingSkill] = React.useState(false);

  // Default the local picker to the app's active repo once repos load.
  React.useEffect(() => {
    if (!repoId && activeRepoId) setRepoId(activeRepoId);
  }, [repoId, activeRepoId]);

  const { data: candidates, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions();

  const list = (candidates ?? []).filter((c) => !c.rejected);
  const hasCandidates = (candidates ?? []).length > 0;
  const accepted = list.filter((c) => c.accepted);
  const acceptedIds = accepted.map((c) => c.id);

  return (
    <AppShell crumb={[{ label: "Skills Lab" }, { label: "Conventions" }]}>
      <div style={s.wrap}>
        <div style={s.headerRow}>
          <h1 style={s.h1}>Conventions</h1>
          <div style={s.actionsRow}>
            {acceptedIds.length > 0 && (
              <Button kind="primary" icon="Sparkles" onClick={() => setCreatingSkill(true)}>
                Create skill
              </Button>
            )}
            <Button
              kind={hasCandidates ? "secondary" : "primary"}
              icon="RefreshCw"
              loading={extract.isPending}
              disabled={!repoId || extract.isPending}
              onClick={() => repoId && extract.mutate(repoId)}
            >
              {hasCandidates ? "ReScan" : "Run Scan"}
            </Button>
          </div>
        </div>

        <div style={s.repoPicker}>
          <span style={s.repoLabel}>Repository</span>
          <div style={s.repoSelectWrap}>
            {reposLoaded && repos.length > 0 ? (
              <SelectInput
                value={repoId ?? ""}
                onChange={(v) => setRepoId(v)}
                options={repos.map((r) => ({ value: r.id, label: r.full_name }))}
              />
            ) : (
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>No repos yet</span>
            )}
          </div>
        </div>

        {creatingSkill && repoId && (
          <CreateSkillModal
            repoId={repoId}
            candidateIds={acceptedIds}
            candidateRules={accepted.map((c) => c.rule)}
            onClose={() => setCreatingSkill(false)}
          />
        )}

        {!repoId && (
          <EmptyState
            icon="ListChecks"
            title="Pick a repository"
            body="Conventions are extracted per-repo — choose one above to get started."
          />
        )}

        {repoId && isLoading && (
          <div style={s.list}>
            <Skeleton height={90} />
            <Skeleton height={90} />
          </div>
        )}

        {repoId && isError && <ErrorState body="Could not load conventions." onRetry={() => refetch()} />}

        {repoId && !isLoading && !isError && !hasCandidates && (
          <EmptyState
            icon="ListChecks"
            title="No conventions extracted yet"
            body="Run a scan to infer this repo's coding conventions from its config and top files."
            cta="Run Scan"
            onCta={() => extract.mutate(repoId)}
          />
        )}

        {repoId && !isLoading && !isError && hasCandidates && list.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title="Nothing left to review"
            body="All extracted candidates were reviewed. Run ReScan to look for more."
          />
        )}

        {list.length > 0 && (
          <div style={s.list}>
            {list.map((c) => (
              <ConventionCard key={c.id} candidate={c} repoId={repoId!} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
