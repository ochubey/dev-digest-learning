/* SkillsView — CSS grid of skill cards on /skills. Clicking a card goes
   straight to /skills/[id]?tab=config (like /agents); "Add Skill" opens
   AddSkillModal (Create/Import choice) and lands on the new skill's editor. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills } from "../../../../lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { ImportDialog } from "../ImportDialog";
import { AddSkillModal } from "../AddSkillModal";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsView() {
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const [search, setSearch] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const list = filterSkills(skills ?? [], search);
  const openSkill = (id: string) => router.push(`/skills/${id}?tab=config`);

  return (
    <AppShell crumb={[{ label: "Skills Lab" }, { label: "Skills" }]}>
      {adding && (
        <AddSkillModal
          onClose={() => setAdding(false)}
          onCreated={(skill) => {
            setAdding(false);
            openSkill(skill.id);
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
            openSkill(skill.id);
          }}
        />
      )}

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
                <SkillCard key={sk.id} skill={sk} onClick={() => openSkill(sk.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
