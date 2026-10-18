"use client";

import React, { Suspense } from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { AgentPerformanceView } from "./_components/AgentPerformanceView";

/* Route: /agent-performance (Skills Lab > Agent Performance, SPEC-06). Thin entry; the page lives in
   _components/AgentPerformanceView. Suspense: the view reads the period from the URL (useSearchParams). */
export default function AgentPerformancePage() {
  const t = useTranslations("agentPerformance");
  return (
    <AppShell crumb={[{ label: t("breadcrumbLab") }, { label: t("title") }]}>
      <Suspense fallback={null}>
        <AgentPerformanceView />
      </Suspense>
    </AppShell>
  );
}
