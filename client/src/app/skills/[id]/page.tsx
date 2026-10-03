/* /skills/:id — the full Skill Editor route (Config / Preview / Versioning
   tabs), reached from the Skills Lab grid's preview drawer via "Open". Tab
   state lives in ?tab= (mirrors the Agent Editor's pattern). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Badge, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { useSkill } from "../../../lib/hooks/skills";
import { ApiError } from "../../../lib/api";
import { SkillEditor } from "../_components/SkillEditor";
import { SKILL_TYPE_COLOR } from "../../../components/skill-type";

export default function SkillDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;

  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);

  const VALID_TABS = ["config", "preview", "versions"];
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
      {isLoading || !skill ? (
        <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
          <Skeleton height={24} width={240} />
          <Skeleton height={200} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 52px)" }}>
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
          <div style={{ flex: 1, minHeight: 0 }}>
            <SkillEditor
              skill={skill}
              tab={tab}
              onTab={setTab}
              onDeleted={() => router.push("/skills")}
            />
          </div>
        </div>
      )}
    </AppShell>
  );
}
