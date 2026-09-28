/* SkillPreviewDrawer — side-panel PEEK for a clicked card: rendered
   markdown + metadata, with an "Open" action to the full /skills/:id editor
   route (Config/Preview/Versioning tabs). Lighter-weight than the full
   editor — no inline editing here. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Drawer, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { SKILL_TYPE_COLOR } from "../../../../../../components/skill-type";
import { s } from "./styles";

export function SkillPreviewDrawer({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const router = useRouter();
  const color = SKILL_TYPE_COLOR[skill.type];

  return (
    <Drawer
      width={640}
      title={skill.name}
      subtitle={skill.description || "No description"}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            Close
          </Button>
          <Button kind="primary" icon="ExternalLink" onClick={() => router.push(`/skills/${skill.id}`)}>
            Open
          </Button>
        </div>
      }
    >
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
        <Badge color={skill.enabled ? "var(--ok, #16a34a)" : "var(--text-muted)"}>
          {skill.enabled ? "enabled" : "disabled"}
        </Badge>
      </div>
      <div style={s.body}>
        {skill.body.trim() ? <Markdown>{skill.body}</Markdown> : <div style={s.empty}>This skill's body is empty.</div>}
      </div>
    </Drawer>
  );
}
