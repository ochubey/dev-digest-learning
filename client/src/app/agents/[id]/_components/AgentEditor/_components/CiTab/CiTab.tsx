"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, EmptyState, ErrorState, FormField, SelectInput, Skeleton } from "@devdigest/ui";
import type { Agent, CiFailOn, CiInstallation } from "@devdigest/shared";
import { CiRunsTable, ExportCiWizard, FAIL_ON_VALUES, formatTime, knownPostAs, knownTriggers, safeGithubUrl, type ExportCiWizardProps } from "@/components/ci-export";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { useAgentCi, useCiSync } from "@/lib/hooks/ci";
import { s } from "./styles";

type WizardInit = ExportCiWizardProps["initial"];

/** CI tab: where the agent runs in CI, its Fail CI on gate, and its recent CI runs (AC-81..AC-88). */
export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ciExport.tab");
  const tRuns = useTranslations("ciRuns.table");
  const view = useAgentCi(agent.id);
  const sync = useCiSync();
  const update = useUpdateAgent();
  const [wizard, setWizard] = React.useState<{ initial?: WizardInit } | null>(null);
  const [saveFailed, setSaveFailed] = React.useState(false);
  const opener = React.useRef<HTMLElement | null>(null);

  // One sync when the tab opens (the ref keeps StrictMode's double effect from firing two).
  const synced = React.useRef(false);
  React.useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    sync.mutate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (e: React.MouseEvent<HTMLElement>, initial?: WizardInit) => {
    opener.current = e.currentTarget;
    setWizard({ initial });
  };

  const changeFailOn = (v: string) => {
    setSaveFailed(false);
    update.mutate({ id: agent.id, patch: { ci_fail_on: v as CiFailOn } }, { onError: () => setSaveFailed(true) });
  };

  const installations = view.data?.installations ?? [];

  const statusText = (i: CiInstallation) => {
    const last = i.last_run;
    if (!last) return t("noRuns");
    const status = last.status && ["succeeded", "no_findings", "failed", "running"].includes(last.status)
      ? tRuns(`status.${last.status as "succeeded"}`)
      : (last.status ?? tRuns("noValue"));
    return t("lastRun", { status, time: formatTime(last.ran_at) });
  };

  return (
    <div style={s.wrap}>
      {view.isLoading ? (
        <div style={s.skeleton} role="status" aria-label={t("loading")}>
          <Skeleton height={20} width={240} />
          <Skeleton height={64} />
        </div>
      ) : view.isError ? (
        <ErrorState title={t("errorTitle")} body={t("errorBody")} onRetry={() => void view.refetch()} />
      ) : (
        <>
          {installations.length === 0 ? (
            <EmptyState
              icon="Workflow"
              title={t("empty")}
              body={t("emptyBody")}
              cta={t("addToCi")}
              onCta={() => {
                opener.current = document.activeElement as HTMLElement | null;
                setWizard({});
              }}
            />
          ) : (
            <>
              <div style={s.header}>
                <h2 style={s.title}>{t("title")}</h2>
                <Button kind="primary" size="sm" icon="Plus" onClick={(e) => open(e)}>
                  {t("addRepo")}
                </Button>
              </div>
              <ul style={s.list}>
                {installations.map((i) => {
                  const prUrl = safeGithubUrl(i.pr_url);
                  return (
                    <li key={i.id} style={s.row}>
                      <div style={s.rowTop}>
                        <span style={s.repo}>{i.repo}</span>
                        {i.config_changed && <Badge color="var(--warn)">{t("configChanged")}</Badge>}
                        {i.config_changed && (
                          <Button
                            size="sm"
                            icon="RefreshCw"
                            onClick={(e) =>
                              open(e, {
                                repo: i.repo,
                                triggers: knownTriggers(i.triggers),
                                postAs: knownPostAs(i.post_as),
                              })
                            }
                          >
                            {t("updateConfig")}
                          </Button>
                        )}
                      </div>
                      <div style={s.meta}>
                        <span>{t("target")}</span>
                        {i.workflow_version != null && <span>{t("workflowVersion", { version: i.workflow_version })}</span>}
                        <span>{t("installedAt", { time: formatTime(i.installed_at) })}</span>
                        {prUrl ? (
                          <a href={prUrl} target="_blank" rel="noopener noreferrer" style={s.link}>
                            {t("prLink")}
                          </a>
                        ) : (
                          <span>{t("filesDownloaded")}</span>
                        )}
                        <span>{statusText(i)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <FormField label={t("failOn")} hint={t("failOnHint")}>
            <div style={s.failOn}>
              <SelectInput
                value={agent.ci_fail_on}
                onChange={changeFailOn}
                options={FAIL_ON_VALUES.map((v) => ({ value: v, label: t(`failOnOptions.${v}`) }))}
              />
            </div>
          </FormField>
          {saveFailed && (
            <p style={s.error} role="alert">
              {t("failOnSaveFailed")}
            </p>
          )}

          {installations.length > 0 && (
            <section style={s.section} aria-label={t("runsTitle")}>
              <h3 style={s.sectionTitle}>{t("runsTitle")}</h3>
              <CiRunsTable runs={view.data?.runs ?? []} showAgent={false} />
            </section>
          )}
        </>
      )}
      {wizard && (
        <ExportCiWizard
          agent={agent}
          initial={wizard.initial}
          returnFocusRef={opener}
          onClose={() => setWizard(null)}
        />
      )}
    </div>
  );
}
