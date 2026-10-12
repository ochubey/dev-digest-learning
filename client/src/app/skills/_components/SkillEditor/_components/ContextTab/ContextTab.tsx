/* ContextTab (skill) — always-expanded project-context picker for a skill.
   Agents using the skill inherit the attached documents. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import {
  ContextDocPicker,
  ContextRepoPicker,
  serializeAs,
  serializeAsText,
  useContextRepo,
} from "@/components/project-context";
import { useContextDocs, useSkillContext } from "@/lib/hooks/project-context";
import { s } from "./styles";

export function ContextTab({ skill }: { skill: Skill | null }) {
  const t = useTranslations("skills.projectContext");
  if (!skill) {
    return (
      <div style={s.wrap}>
        <h2 style={s.title}>{t("title")}</h2>
        <p style={s.hint}>{t("disabledUnsaved")}</p>
      </div>
    );
  }
  return <SavedSkillContext skillId={skill.id} />;
}

function SavedSkillContext({ skillId }: { skillId: string }) {
  const t = useTranslations("skills.projectContext");
  const tc = useTranslations("projectContext");
  const { repos, repoId, select } = useContextRepo();
  const attachedQ = useSkillContext(skillId);
  const docsQ = useContextDocs(repoId);

  const attached = attachedQ.data?.paths ?? [];
  const docs = docsQ.data?.docs;
  // Only attached documents that exist on main are injected (AC-32).
  const found = docs ? attached.filter((p) => docs.some((d) => d.path === p)) : [];
  const serialized = serializeAsText(serializeAs(found));

  return (
    <div style={s.wrap}>
      <div style={s.titleRow}>
        <h2 style={s.title}>{t("title")}</h2>
        <Badge>{tc("summary.attached", { count: attached.length })}</Badge>
      </div>
      <p style={s.hint}>{t("hint")}</p>

      <ContextRepoPicker repos={repos} value={repoId} onChange={select} />

      {docs && docs.length > 0 && attached.length === 0 && (
        <p style={s.hint}>{t("noneAttached")}</p>
      )}

      <ContextDocPicker repoId={repoId} owner={{ kind: "skill", id: skillId }} hideSummary />

      {found.length > 0 && (
        <div data-testid="context-serializes-as" style={s.serializes}>
          <span style={s.serializesLabel}>{t("serializesAs")}</span>
          <pre style={s.pre}>{serialized}</pre>
        </div>
      )}
    </div>
  );
}
