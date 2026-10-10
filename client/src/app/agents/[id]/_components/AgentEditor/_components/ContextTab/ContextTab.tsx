"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Agent } from "@devdigest/shared";
import { ContextDocPicker, ContextRepoPicker, useContextRepo } from "@/components/project-context";
import { s } from "./styles";

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { repos, repoId, select } = useContextRepo();
  return (
    <div style={s.wrap}>
      <div>
        <h2 style={s.title}>{t("context.title")}</h2>
        <p style={s.hint}>{t("context.hint")}</p>
      </div>
      <ContextRepoPicker repos={repos} value={repoId} onChange={select} />
      <ContextDocPicker repoId={repoId} owner={{ kind: "agent", id: agent.id }} />
    </div>
  );
}
