/* AddSkillModal — "Add Skill" entry point. First step: Create/Import
   choice, both inside a Modal (mirrors CreateAgentModal's shape). Choosing
   Create swaps to the name/description/type/body form, in the same modal.
   Choosing Import closes this modal and opens the existing ImportDialog
   (also a Modal), which already has its own file-preview-then-confirm flow. */
"use client";

import React from "react";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../lib/hooks/skills";
import { SKILL_TYPE_OPTIONS } from "../ImportDialog/constants";
import { s } from "./styles";

export function AddSkillModal({
  onClose,
  onCreated,
  onChooseImport,
}: {
  onClose: () => void;
  onCreated: (skill: Skill) => void;
  onChooseImport: () => void;
}) {
  const create = useCreateSkill();
  const [step, setStep] = React.useState<"choose" | "create">("choose");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");

  const submit = async () => {
    if (!name.trim() || !body.trim()) return;
    const skill = await create.mutateAsync({ name, description, type, body });
    onCreated(skill);
  };

  if (step === "choose") {
    return (
      <Modal width={480} title="Add skill" subtitle="Create a new skill, or import one from a file" onClose={onClose}>
        <div style={s.chooseBody}>
          <button style={s.chooseOption} onClick={() => setStep("create")}>
            <div style={s.chooseTitle}>Create from scratch</div>
            <div style={s.chooseSubtitle}>Write a new skill's name, description, type and body.</div>
          </button>
          <button style={s.chooseOption} onClick={onChooseImport}>
            <div style={s.chooseTitle}>Import from file</div>
            <div style={s.chooseSubtitle}>Upload a .md file, or a .zip containing one.</div>
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      width={640}
      title="Create skill"
      subtitle="Name, description, type and body"
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={() => setStep("choose")} disabled={create.isPending}>
            Back
          </Button>
          <Button kind="primary" icon="Plus" onClick={submit} disabled={create.isPending || !name.trim() || !body.trim()}>
            {create.isPending ? "Creating…" : "Create skill"}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <FormField label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="pr-quality-rubric" />
        </FormField>
        <FormField label="Description">
          <TextInput value={description} onChange={setDescription} placeholder="What this skill checks or enforces" />
        </FormField>
        <FormField label="Type">
          <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={SKILL_TYPE_OPTIONS} />
        </FormField>
        <FormField label="Body (Markdown)">
          <Textarea value={body} onChange={setBody} rows={12} mono placeholder="# Rule&#10;Describe the rule…" />
        </FormField>
      </div>
    </Modal>
  );
}
