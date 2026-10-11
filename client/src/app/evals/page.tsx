"use client";

import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { EvalOverview } from "./_components/EvalOverview";

/* Route: /evals (Skills Lab > Eval Dashboard). Thin entry; the landing lives in _components/EvalOverview. */
export default function EvalsPage() {
  const t = useTranslations("evalsDashboard");
  return (
    <AppShell crumb={[{ label: t("breadcrumbLab") }, { label: t("breadcrumb") }]}>
      <EvalOverview />
    </AppShell>
  );
}
