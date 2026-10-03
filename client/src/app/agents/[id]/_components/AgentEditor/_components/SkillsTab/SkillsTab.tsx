"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Checkbox, Icon, TextInput } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useSkills, useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/skills";
import { SKILL_TYPE_COLOR } from "./constants";
import { s } from "./styles";

/** Skills tab — ordered toggle-list of ALL workspace skills; checked = linked
    to this agent. Order (top-to-bottom) is prompt-assembly order. Reorder is
    real drag&drop via `@dnd-kit/sortable`, restricted to LINKED skills — an
    unlinked row's handle is visually disabled and not draggable, matching
    the old up/down-arrow no-op behavior but now genuinely inert in the UI.
    Same end result on drop (`POST /agents/:id/skills` with the full reordered
    `skill_ids`). */
export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const [filter, setFilter] = React.useState("");

  const { data: allSkills } = useSkills();
  const { data: linkedSkills } = useAgentSkills(agent.id);
  const setAgentSkills = useSetAgentSkills();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Linked skills, in the agent's current prompt-assembly order.
  const linkedIds = React.useMemo(
    () => (linkedSkills ?? []).map((link) => link.skill_id),
    [linkedSkills],
  );

  // Full display order: linked skills first (in their order), then unlinked
  // skills after — so the ordered/linked portion is what drag-to-reorder
  // actually reorders, while unlinked skills are still visible to toggle on.
  const ordered = React.useMemo(() => {
    const byId = new Map((allSkills ?? []).map((sk) => [sk.id, sk] as const));
    const linked = linkedIds.map((id) => byId.get(id)).filter((sk): sk is Skill => !!sk);
    const unlinked = (allSkills ?? []).filter((sk) => !linkedIds.includes(sk.id));
    return [...linked, ...unlinked];
  }, [allSkills, linkedIds]);

  const visible = ordered.filter((sk) => sk.name.toLowerCase().includes(filter.toLowerCase()));

  const total = allSkills?.length ?? 0;
  const linkedCount = linkedIds.length;

  const save = (nextLinkedIds: string[]) =>
    setAgentSkills.mutate({ agentId: agent.id, skillIds: nextLinkedIds });

  const toggle = (skillId: string) => {
    const next = linkedIds.includes(skillId)
      ? linkedIds.filter((id) => id !== skillId)
      : [...linkedIds, skillId];
    save(next);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Only linked rows are draggable/droppable targets — filter guards against
    // a keyboard-navigated drag landing on an unlinked row.
    if (!linkedIds.includes(String(active.id)) || !linkedIds.includes(String(over.id))) return;
    const oldIndex = linkedIds.indexOf(String(active.id));
    const newIndex = linkedIds.indexOf(String(over.id));
    save(arrayMove(linkedIds, oldIndex, newIndex));
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <span style={s.countBadge}>
          <Badge>{t("skills.enabledCount", { linked: linkedCount, total })}</Badge>
        </span>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>
      <div style={s.filterRow}>
        <TextInput value={filter} onChange={setFilter} placeholder={t("skills.filterPlaceholder")} />
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visible.map((sk) => sk.id)} strategy={verticalListSortingStrategy}>
          <div style={s.list}>
            {visible.length === 0 && <div style={s.empty}>{t("skills.filterPlaceholder")}</div>}
            {visible.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                isLinked={linkedIds.includes(skill.id)}
                onToggle={() => toggle(skill.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

/** A single row — draggable only when `isLinked`; unlinked rows render a
    visually disabled handle (no listeners attached, cursor not-allowed). */
function SkillRow({
  skill,
  isLinked,
  onToggle,
}: {
  skill: Skill;
  isLinked: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: skill.id,
    disabled: !isLinked,
  });

  const style: React.CSSProperties = {
    ...s.row,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <span
        style={isLinked ? s.dragHandle : s.dragHandleDisabled}
        aria-hidden={!isLinked}
        title={isLinked ? undefined : "Only linked skills can be reordered"}
        {...(isLinked ? { ...attributes, ...listeners } : {})}
      >
        <Icon.Menu size={14} />
      </span>
      <Checkbox checked={isLinked} onChange={onToggle} />
      <span className="mono" style={s.name}>
        {skill.name}
      </span>
      <Badge color={SKILL_TYPE_COLOR[skill.type]} bg="transparent">
        {skill.type}
      </Badge>
    </div>
  );
}
