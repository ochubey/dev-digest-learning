/* DeleteSkillModal — real confirm modal (Confirm/Cancel/X), not
   window.confirm. Opened from the delete button on the card itself. */
"use client";

import React from "react";
import { Button, Modal } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useDeleteSkill } from "../../../../../../lib/hooks/skills";
import { s } from "./styles";

export function DeleteSkillModal({
  skill,
  onClose,
  onDeleted,
}: {
  skill: Skill;
  onClose: () => void;
  /** Called after a successful delete, after the modal closed. */
  onDeleted?: () => void;
}) {
  const del = useDeleteSkill();

  const confirm = () => {
    del.mutate(skill.id, {
      onSuccess: () => {
        onClose();
        onDeleted?.();
      },
    });
  };

  return (
    <Modal
      width={440}
      title="Delete skill?"
      subtitle={`"${skill.name}" will be permanently deleted. This cannot be undone.`}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button kind="danger" icon="Trash" onClick={confirm} disabled={del.isPending}>
            {del.isPending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        This removes the skill and unlinks it from any agents currently using it
        {skill.agent_count > 0 ? ` (currently linked to ${skill.agent_count} agent${skill.agent_count === 1 ? "" : "s"})` : ""}.
      </div>
    </Modal>
  );
}
