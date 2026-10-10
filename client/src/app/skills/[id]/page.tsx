/* /skills/:id — the full Skill Editor route (Config / Context / Preview / Versioning
   tabs), reached by clicking a card in the Skills Lab grid. Master-detail like
   /agents/:id: skill list on the left, editor on the right. Tab state lives
   in ?tab=. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Badge, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { useSkill } from "../../../lib/hooks/skills";
import { ApiError } from "../../../lib/api";
import { SkillEditor } from "../_components/SkillEditor";
import { SkillsSidebar } from "../_components/SkillsSidebar";
import { TABS } from "../_components/SkillEditor/constants";
import { SKILL_TYPE_COLOR } from "../../../components/skill-type";

export default function SkillDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;

  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const VALID_TABS = TABS.map((tb) => (typeof tb === "string" ? tb : tb.key));
  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (t: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", t);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: "Skills Lab" },
    { label: "Skills", href: "/skills" },
    { label: skill?.name ?? "Skill" },
  ];

  if (isError || (!isLoading && !skill)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this skill"
          body={error instanceof ApiError ? error.message : "The skill could not be loaded."}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        <SkillsSidebar activeId={id} tab={tab} />

        {isLoading || !skill ? (
          <div style={{ flex: 1, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 28px 0", flexShrink: 0 }}>
              <Icon.FileText size={18} style={{ color: "var(--accent)" }} />
              <h1 style={{ fontSize: 18, fontWeight: 700 }}>{skill.name}</h1>
              <Badge color={SKILL_TYPE_COLOR[skill.type]} bg="transparent">
                {skill.type}
              </Badge>
              <Badge color="var(--text-secondary)" mono>
                v{skill.version}
              </Badge>
              <Badge color="var(--text-muted)" icon="Users">
                {skill.agent_count} agent{skill.agent_count === 1 ? "" : "s"}
              </Badge>
              {!skill.enabled && <Badge color="var(--text-muted)">disabled</Badge>}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
              <SkillEditor skill={skill} tab={tab} onTab={setTab} onDeleted={() => router.push("/skills")} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
