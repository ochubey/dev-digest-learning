"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { AgentEvalPage } from "./_components/AgentEvalPage";

/* Route: /evals/[agentId]. The agent id in the URL makes the page linkable (AC-63). */
export default function AgentEvalsRoute() {
  const t = useTranslations("evalsDashboard");
  const { agentId } = useParams<{ agentId: string }>();
  return (
    <AppShell crumb={[{ label: t("breadcrumbLab") }, { label: t("breadcrumb"), href: "/evals" }]}>
      <AgentEvalPage key={agentId} agentId={agentId} />
    </AppShell>
  );
}
