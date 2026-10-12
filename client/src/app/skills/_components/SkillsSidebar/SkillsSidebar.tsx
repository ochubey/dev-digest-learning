/* SkillsSidebar — left column of /skills/[id] (mirrors the agent page's list):
   "Skills" heading, an Add button that opens AddSkillModal / ImportDialog in
   place, and every skill as a compact SkillCard with the open one highlighted.
   Clicking a skill keeps the current tab. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@devdigest/ui";
import { useSkills } from "../../../../lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { AddSkillModal } from "../AddSkillModal";
import { ImportDialog } from "../ImportDialog";
import { s } from "./styles";

export function SkillsSidebar({ activeId, tab }: { activeId: string; tab: string }) {
  const router = useRouter();
  const { data: skills } = useSkills();
  const [adding, setAdding] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const openNew = (id: string) => router.push(`/skills/${id}?tab=config`);

  return (
    <aside style={s.aside}>
      {adding && (
        <AddSkillModal
          onClose={() => setAdding(false)}
          onCreated={(skill) => {
            setAdding(false);
            openNew(skill.id);
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
            openNew(skill.id);
          }}
        />
      )}
      <div style={s.header}>
        <div style={s.headerRow}>
          <h1 style={s.h1}>Skills</h1>
          <Button kind="primary" size="sm" icon="Plus" onClick={() => setAdding(true)}>
            Add
          </Button>
        </div>
      </div>
      <div style={s.list}>
        {(skills ?? []).map((sk) => (
          <SkillCard
            key={sk.id}
            skill={sk}
            compact
            active={sk.id === activeId}
            onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
            onDeleted={sk.id === activeId ? () => router.push("/skills") : undefined}
          />
        ))}
      </div>
    </aside>
  );
}
