/* SkillEditor — Config / Preview / Versions / Context tabs for the selected (or new)
   skill. Tab state is local (not URL-synced) since the Skills Lab page
   already tracks selection itself; simpler than AgentEditor's ?tab= pattern
   for this scope. */
"use client";

import React from "react";
import { Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { ContextTab } from "./_components/ContextTab";
import { PreviewTab } from "./_components/PreviewTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { s } from "./styles";

export function SkillEditor({
  skill,
  onCreated,
  onDeleted,
  tab: controlledTab,
  onTab,
}: {
  /** null = create-from-scratch mode. */
  skill: Skill | null;
  onCreated?: (skill: Skill) => void;
  onDeleted?: () => void;
  /** Controlled tab (e.g. ?tab= on the /skills/:id route). Falls back to
      local state when omitted (e.g. embedded in a drawer/inline context). */
  tab?: string;
  onTab?: (tab: string) => void;
}) {
  const [localTab, setLocalTab] = React.useState("config");
  const tab = controlledTab ?? localTab;
  const setTab = onTab ?? setLocalTab;

  // Jump back to Config when switching skills, so Preview/Versions never
  // show stale data from a different skill mid-transition (only relevant
  // to the uncontrolled/local-state case).
  React.useEffect(() => {
    if (!onTab) setLocalTab("config");
  }, [skill?.id, onTab]);

  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={[...TABS]} value={tab} onChange={setTab} pad="0 28px" />
      </div>
      <div style={s.body}>
        {tab === "preview" && <PreviewTab body={skill?.body ?? ""} />}
        {tab === "versions" && <VersionsTab skillId={skill?.id ?? null} currentBody={skill?.body ?? ""} />}
        {tab === "context" && <ContextTab skill={skill} />}
        {tab === "config" && <ConfigTab skill={skill} onCreated={onCreated} onDeleted={onDeleted} />}
      </div>
    </div>
  );
}
