/* CreateSkillModal — explains this builds a skill FROM the accepted
   conventions, Name + Description fields, Cancel + Create. On Create, calls
   POST /repos/:id/conventions/create-skill with the accepted candidate ids. */
"use client";

import React from "react";
import { Button, Modal, FormField, TextInput, Textarea } from "@devdigest/ui";
import { useCreateSkillFromConventions } from "../../../../../../lib/hooks/conventions";
import { s } from "./styles";

export function CreateSkillModal({
  repoId,
  candidateIds,
  candidateRules,
  onClose,
}: {
  repoId: string;
  candidateIds: string[];
  /** Accepted candidates' rule text, used to prefill the editable body below. */
  candidateRules: string[];
  onClose: () => void;
}) {
  const create = useCreateSkillFromConventions();
  const [name, setName] = React.useState("repo-conventions");
  const [description, setDescription] = React.useState(
    "Coding conventions extracted and accepted from this repository.",
  );
  // Rubric #41 — the future skill's BODY must be editable here too, not just
  // name/description. Prefilled with the same markdown-checklist format the
  // server falls back to, so leaving it untouched matches prior behavior.
  const [body, setBody] = React.useState(candidateRules.map((r) => `- ${r}`).join("\n"));

  const submit = async () => {
    await create.mutateAsync({ repoId, name, description, candidateIds, body });
    onClose();
  };

  return (
    <Modal
      width={640}
      title="Create skill from conventions"
      subtitle={`Builds one new skill from ${candidateIds.length} accepted convention${candidateIds.length === 1 ? "" : "s"}`}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            onClick={submit}
            disabled={create.isPending || !name.trim() || !body.trim()}
          >
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.intro}>
          This builds a skill FROM the accepted conventions below — the body
          starts as their rule text concatenated into a markdown checklist,
          editable before saving. The skill is created unlinked — link it to
          an agent from Skills Lab or the Agent editor.
        </div>
        <FormField label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="repo-conventions" />
        </FormField>
        <FormField label="Description">
          <Textarea value={description} onChange={setDescription} rows={3} />
        </FormField>
        <FormField label="Skill body (Markdown)" required>
          <Textarea value={body} onChange={setBody} rows={8} mono />
        </FormField>
      </div>
    </Modal>
  );
}
