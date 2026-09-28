/* VersionsTab — version history with Diff (word-level, against the current
   body) and Restore (bumps version, snapshots the pre-restore body first). */
"use client";

import React from "react";
import { Button, EmptyState, Skeleton } from "@devdigest/ui";
import { useSkillVersions, useRestoreSkillVersion } from "../../../../../../lib/hooks/skills";
import { DiffModal } from "./_components/DiffModal";
import { s } from "./styles";

export function VersionsTab({
  skillId,
  currentBody,
}: {
  skillId: string | null;
  /** Current skill body — the Diff button compares a snapshot against this. */
  currentBody: string;
}) {
  const { data: versions, isLoading } = useSkillVersions(skillId);
  const restore = useRestoreSkillVersion();
  const [diffing, setDiffing] = React.useState<{ version: number; body: string } | null>(null);

  if (!skillId) {
    return (
      <EmptyState
        icon="History"
        title="No version history yet"
        body="Save this skill first to start its version history."
      />
    );
  }

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={80} />
        <Skeleton height={80} />
      </div>
    );
  }

  if (!versions || versions.length === 0) {
    return <EmptyState icon="History" title="No versions recorded" />;
  }

  const doRestore = (version: number) => {
    if (!skillId) return;
    if (!window.confirm(`Restore this skill's body to v${version}? This creates a new version.`)) return;
    restore.mutate({ id: skillId, version });
  };

  return (
    <div style={s.wrap}>
      {diffing && (
        <DiffModal
          version={diffing.version}
          oldBody={diffing.body}
          currentBody={currentBody}
          onClose={() => setDiffing(null)}
        />
      )}
      {versions.map((v) => (
        <div key={v.version} style={s.row}>
          <div style={s.rowHeader}>
            <span style={s.version}>v{v.version}</span>
            <span style={s.date}>{new Date(v.created_at).toLocaleString()}</span>
            <div style={s.actions}>
              <Button kind="ghost" size="sm" icon="GitCommit" onClick={() => setDiffing({ version: v.version, body: v.body })}>
                Diff
              </Button>
              <Button
                kind="secondary"
                size="sm"
                icon="RefreshCw"
                onClick={() => doRestore(v.version)}
                disabled={restore.isPending}
              >
                Restore
              </Button>
            </div>
          </div>
          <div style={s.body}>{v.body}</div>
        </div>
      ))}
    </div>
  );
}
