/* SkillCard — grid card for the Skills Lab: name, description, type badge,
   source icon, agent_count badge, enabled toggle, and a delete button (opens
   a real confirm Modal, not window.confirm). Clicking the card body opens
   the preview drawer (handled by the parent via onClick). */
"use client";

import React from "react";
import { Icon, Badge, Toggle, IconBtn } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { SKILL_TYPE_COLOR } from "../../../../components/skill-type";
import { useSetSkillEnabled } from "../../../../lib/hooks/skills";
import { SKILL_SOURCE_ICON } from "./constants";
import { DeleteSkillModal } from "./_components/DeleteSkillModal";
import { s } from "./styles";

export function SkillCard({ skill, onClick }: { skill: Skill; onClick?: () => void }) {
  const setEnabled = useSetSkillEnabled();
  const [deleting, setDeleting] = React.useState(false);
  const color = SKILL_TYPE_COLOR[skill.type];
  const SourceIcon = Icon[SKILL_SOURCE_ICON[skill.source]];

  return (
    <div onClick={onClick} style={s.card(skill.enabled)}>
      {deleting && <DeleteSkillModal skill={skill} onClose={() => setDeleting(false)} />}
      <div style={s.headerRow}>
        <div style={s.iconBox} title={skill.source}>
          <Icon.FileText size={15} />
        </div>
        <span style={s.name}>{skill.name}</span>
        <span title={skill.source} aria-label={skill.source} style={{ color: "var(--text-muted)" }}>
          <SourceIcon size={13} />
        </span>
      </div>
      <div style={s.description}>{skill.description || "No description"}</div>
      <div style={s.metaRow}>
        <Badge color={color} bg="transparent">
          {skill.type}
        </Badge>
        <Badge color="var(--text-secondary)" mono>
          v{skill.version}
        </Badge>
        <Badge color="var(--text-muted)" icon="Users">
          {skill.agent_count} agent{skill.agent_count === 1 ? "" : "s"}
        </Badge>
      </div>
      <div style={s.footerRow} onClick={(e) => e.stopPropagation()}>
        <Toggle on={skill.enabled} onChange={(enabled) => setEnabled.mutate({ id: skill.id, enabled })} size={14} />
        <div style={s.spacer} />
        <IconBtn icon="Trash" label="Delete skill" onClick={() => setDeleting(true)} />
      </div>
    </div>
  );
}
