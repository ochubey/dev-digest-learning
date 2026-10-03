/* SkillsView — CSS grid of skill cards on /skills. Clicking a card opens a
   side-panel preview (SkillPreviewDrawer); "Add Skill" opens AddSkillModal
   (Create/Import choice). Full editing lives at /skills/[id]. */
"use client";

import React from "react";
import { Button, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell";
import { useSkills } from "../../../../lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { ImportDialog } from "../ImportDialog";
import { AddSkillModal } from "../AddSkillModal";
import { SkillPreviewDrawer } from "./_components/SkillPreviewDrawer";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsView() {
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const [search, setSearch] = React.useState("");
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const list = filterSkills(skills ?? [], search);
  const preview: Skill | null = (skills ?? []).find((sk) => sk.id === previewId) ?? null;

  return (
    <AppShell crumb={[{ label: "Skills Lab" }, { label: "Skills" }]}>
      {adding && (
        <AddSkillModal
          onClose={() => setAdding(false)}
          onCreated={(skill) => {
            setAdding(false);
            setPreviewId(skill.id);
          }}
          onChooseImport={() => {
            setAdding(false);
            setImporting(true);
          }}
        />
      )}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImported={(skill) => {
            setImporting(false);
            setPreviewId(skill.id);
          }}
        />
      )}
      {preview && <SkillPreviewDrawer skill={preview} onClose={() => setPreviewId(null)} />}

      <div style={s.wrap}>
        <div style={s.header}>
          <h1 style={s.h1}>Skills</h1>
          <div style={s.searchRow}>
            <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills…"
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                fontSize: 13,
                marginLeft: 6,
                width: "100%",
              }}
            />
          </div>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setAdding(true)}>
            Add Skill
          </Button>
        </div>

        <div style={s.body}>
          {isLoading && (
            <div style={s.grid}>
              <Skeleton height={150} />
              <Skeleton height={150} />
              <Skeleton height={150} />
            </div>
          )}
          {isError && <ErrorState body="Could not load skills." onRetry={() => refetch()} />}
          {!isLoading && !isError && list.length === 0 && (
            <EmptyState
              icon="Sparkles"
              title="No skills yet"
              body="Create a skill from scratch, or import one from a file."
              cta="Add Skill"
              onCta={() => setAdding(true)}
            />
          )}
          {!isLoading && !isError && list.length > 0 && (
            <div style={s.grid}>
              {list.map((sk) => (
                <SkillCard key={sk.id} skill={sk} onClick={() => setPreviewId(sk.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
