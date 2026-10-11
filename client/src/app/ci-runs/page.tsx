"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { CiRunsView } from "./_components/CiRunsView";

/* Route: /ci-runs. Thin entry; the page lives in _components/CiRunsView. */
export default function CiRunsPage() {
  const t = useTranslations("ciRuns.page");
  return (
    <AppShell crumb={[{ label: t("breadcrumb") }]}>
      <CiRunsView />
    </AppShell>
  );
}
