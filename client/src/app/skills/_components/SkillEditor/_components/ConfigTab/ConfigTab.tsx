/* ConfigTab — name/description/type/body form. Handles both create (skill
   is null) and edit (skill set) modes; Save routes to useCreateSkill or
   useUpdateSkill accordingly. Body editor is a plain controlled <textarea>
   via @devdigest/ui's Textarea (mono) — the design mock's line-numbered
   CodeEditor is a nice-to-have, not load-bearing, and a plain textarea is
   the simpler, lower-risk choice here. */
"use client";

import React from "react";
import { Button, FormField, TextInput, SelectInput, Textarea, Toggle } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import {
  useCreateSkill,
  useUpdateSkill,
  useSetSkillEnabled,
  useDeleteSkill,
} from "../../../../../../lib/hooks/skills";
import { SKILL_TYPE_OPTIONS, estimateTokens } from "./constants";
import { s } from "./styles";

export function ConfigTab({
  skill,
  onCreated,
  onDeleted,
}: {
  /** null = create-from-scratch mode. */
  skill: Skill | null;
  onCreated?: (skill: Skill) => void;
  onDeleted?: () => void;
}) {
  const create = useCreateSkill();
  const update = useUpdateSkill();
  const setEnabled = useSetSkillEnabled();
  const del = useDeleteSkill();

  const [name, setName] = React.useState(skill?.name ?? "");
  const [description, setDescription] = React.useState(skill?.description ?? "");
  const [type, setType] = React.useState<SkillType>(skill?.type ?? "custom");
  const [body, setBody] = React.useState(skill?.body ?? "");
  const [enabled, setEnabledLocal] = React.useState(skill?.enabled ?? true);

  // Re-sync local form state when the selected skill changes (including
  // switching to/from create mode).
  React.useEffect(() => {
    setName(skill?.name ?? "");
    setDescription(skill?.description ?? "");
    setType(skill?.type ?? "custom");
    setBody(skill?.body ?? "");
    setEnabledLocal(skill?.enabled ?? true);
  }, [skill?.id]);

  const dirty =
    skill == null ||
    name !== skill.name ||
    description !== skill.description ||
    type !== skill.type ||
    body !== skill.body;

  const cancel = () => {
    setName(skill?.name ?? "");
    setDescription(skill?.description ?? "");
    setType(skill?.type ?? "custom");
    setBody(skill?.body ?? "");
    setEnabledLocal(skill?.enabled ?? true);
  };

  const save = async () => {
    if (!name.trim() || !body.trim()) return;
    if (skill == null) {
      const created = await create.mutateAsync({ name, description, type, body, enabled });
      onCreated?.(created);
    } else {
      await update.mutateAsync({ id: skill.id, patch: { name, description, type, body } });
    }
  };

  const toggleEnabled = (next: boolean) => {
    setEnabledLocal(next);
    if (skill) setEnabled.mutate({ id: skill.id, enabled: next });
  };

  const remove = () => {
    if (!skill) return;
    if (window.confirm(`Delete skill "${skill.name}"? This cannot be undone.`)) {
      del.mutate(skill.id, { onSuccess: () => onDeleted?.() });
    }
  };

  const saving = create.isPending || update.isPending;

  return (
    <div style={s.wrap}>
      <FormField label="Name" required>
        <TextInput value={name} onChange={setName} placeholder="pr-quality-rubric" />
      </FormField>
      <FormField label="Description">
        <TextInput
          value={description}
          onChange={setDescription}
          placeholder="What this skill checks or enforces"
        />
      </FormField>
      <FormField label="Type">
        <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={SKILL_TYPE_OPTIONS} />
      </FormField>
      <FormField
        label="Body (Markdown)"
        right={<span style={s.tokenCount}>~{estimateTokens(body)} tokens</span>}
      >
        <Textarea value={body} onChange={setBody} rows={16} mono placeholder="# Rule&#10;Describe the rule…" />
      </FormField>
      {skill && (
        <FormField label="Enabled">
          <Toggle on={enabled} onChange={toggleEnabled} />
        </FormField>
      )}

      <div style={s.footer}>
        {skill && (
          <Button kind="danger" icon="Trash" onClick={remove} disabled={del.isPending}>
            Delete
          </Button>
        )}
        <div style={s.spacer} />
        <Button kind="ghost" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
        <Button kind="primary" onClick={save} disabled={saving || !dirty || !name.trim() || !body.trim()}>
          {saving ? "Saving…" : skill ? "Save" : "Create Skill"}
        </Button>
      </div>
    </div>
  );
}
