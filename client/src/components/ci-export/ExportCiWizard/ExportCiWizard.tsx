"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps } from "@devdigest/ui";
import type { Agent, CiExport, CiExportInputBody, CiPostAs, CiPreview, CiTrigger } from "@devdigest/shared";
import { EvalDialog } from "@/components/evals";
import { ApiError } from "@/lib/api";
import { useRepos } from "@/lib/hooks/core";
import { useCiExport, useCiPreview } from "@/lib/hooks/ci";
import { CI_CODE, CI_WORKFLOW_PATH, DEFAULT_POST_AS, DEFAULT_TRIGGERS, WIZARD_STEPS } from "../constants";
import { downloadBase64Zip } from "../helpers";
import { sameConfig, sortTriggers } from "./helpers";
import { ConfigureStep } from "./_components/ConfigureStep";
import { InstallStep, type InstallAction } from "./_components/InstallStep";
import { PreviewStep } from "./_components/PreviewStep";
import { TargetStep } from "./_components/TargetStep";
import { s } from "./styles";

export interface ExportCiWizardProps {
  agent: Agent;
  /** Preselected values ("Update CI config" passes the installation's). */
  initial?: { repo?: string; triggers?: CiTrigger[]; postAs?: CiPostAs };
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

interface Config {
  triggers: CiTrigger[];
  postAs: CiPostAs;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Export to CI wizard (Target, Preview, Configure, Install). Nothing is written until the user
    picks an install option (AC-9). */
export function ExportCiWizard({ agent, initial, onClose, returnFocusRef }: ExportCiWizardProps) {
  const t = useTranslations("ciExport.wizard");
  const repos = useRepos();
  const previewMut = useCiPreview(agent.id);
  const exportMut = useCiExport(agent.id);

  const [step, setStep] = React.useState(0);
  const [repo, setRepo] = React.useState(initial?.repo ?? "");
  const [triggers, setTriggers] = React.useState<CiTrigger[]>(
    initial?.triggers?.length ? sortTriggers(initial.triggers) : [...DEFAULT_TRIGGERS],
  );
  const [postAs, setPostAs] = React.useState<CiPostAs>(initial?.postAs ?? DEFAULT_POST_AS);
  const [preview, setPreview] = React.useState<CiPreview | null>(null);
  const [previewRepo, setPreviewRepo] = React.useState("");
  const [previewCfg, setPreviewCfg] = React.useState<Config | null>(null);
  const [selectedPath, setSelectedPath] = React.useState(CI_WORKFLOW_PATH);
  const [workflowEdit, setWorkflowEdit] = React.useState<string | null>(null);
  const [askRegenerate, setAskRegenerate] = React.useState(false);
  const [result, setResult] = React.useState<CiExport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingAction, setPendingAction] = React.useState<InstallAction | null>(null);
  const [lastAction, setLastAction] = React.useState<InstallAction | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Focus trap: wrap Tab inside the dialog panel (EvalDialog handles Escape and focus return).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const panel = rootRef.current?.closest<HTMLElement>('[role="dialog"]');
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const labels = WIZARD_STEPS.map((k) => t(`steps.${k}`));
  const unsupportedProvider = agent.provider !== "openrouter";

  const go = (next: number) => {
    setError(null);
    setStep(next);
  };

  const body = (cfg: Config): CiExportInputBody => ({
    repo,
    target: "gha",
    action: "open_pr",
    post_as: cfg.postAs,
    triggers: cfg.triggers,
  });

  const loadPreview = (cfg: Config, onDone?: () => void) =>
    previewMut.mutate(body(cfg), {
      onSuccess: (p) => {
        setPreview(p);
        setPreviewRepo(repo);
        setPreviewCfg(cfg);
        setError(null);
        onDone?.();
      },
      onError: (e) => setError(messageOf(e)),
    });

  const continueFromTarget = () => {
    setError(null);
    if (preview && previewRepo === repo) {
      go(1);
      return;
    }
    setWorkflowEdit(null);
    setSelectedPath(CI_WORKFLOW_PATH);
    loadPreview({ triggers, postAs }, () => go(1));
  };

  // AC-35: leaving Configure with changed values shows the regenerated workflow on Preview.
  const leaveConfigure = (forward: boolean) => {
    const cfg = { triggers, postAs };
    if (!previewCfg || sameConfig(cfg, previewCfg)) {
      go(forward ? 3 : 1);
      return;
    }
    go(1);
    if (workflowEdit !== null) setAskRegenerate(true);
    else loadPreview(cfg);
  };

  const confirmRegenerate = () => {
    setAskRegenerate(false);
    setWorkflowEdit(null);
    loadPreview({ triggers, postAs });
  };

  const cancelRegenerate = () => {
    setAskRegenerate(false);
    if (previewCfg) {
      setTriggers(previewCfg.triggers);
      setPostAs(previewCfg.postAs);
    }
  };

  const install = (action: InstallAction) => {
    setError(null);
    setLastAction(action);
    setPendingAction(action);
    exportMut.mutate(
      { ...body({ triggers, postAs }), action, workflow: workflowEdit },
      {
        onSuccess: (res) => {
          setPendingAction(null);
          if (action === "files" && res.zip_base64) {
            downloadBase64Zip(res.zip_base64, res.zip_filename ?? `devdigest-ci-${repo.split("/").pop()}.zip`);
          }
          setResult(res);
        },
        onError: (e) => {
          setPendingAction(null);
          setError(messageOf(e));
          // AC-29: an unsafe edited workflow sends the user back to fix it on Preview.
          if (e instanceof ApiError && e.code === CI_CODE.workflowUnsafe) setStep(1);
        },
      },
    );
  };

  const busy = previewMut.isPending || pendingAction !== null;

  return (
    <EvalDialog title={t("title")} onClose={onClose} width={760} testId="export-ci-wizard" returnFocusRef={returnFocusRef}>
      <div ref={rootRef} style={s.body}>
        <div style={s.stepsBar}>
          <ExportWizardSteps step={step} labels={labels} />
          <span style={s.srOnly} role="status">
            {t("stepOf", { step: step + 1, total: WIZARD_STEPS.length, label: labels[step] })}
          </span>
        </div>

        {step === 0 && (
          <TargetStep
            repos={repos.data}
            repo={repo}
            onRepo={setRepo}
            unsupportedProvider={unsupportedProvider}
            checking={previewMut.isPending}
            error={error}
          />
        )}
        {step === 1 && preview && (
          <PreviewStep
            files={preview.files}
            runnerVersion={preview.runner_version}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            workflowEdit={workflowEdit}
            onEdit={setWorkflowEdit}
            regenerating={previewMut.isPending}
            askRegenerate={askRegenerate}
            onConfirmRegenerate={confirmRegenerate}
            onCancelRegenerate={cancelRegenerate}
            error={error}
          />
        )}
        {step === 2 && (
          <ConfigureStep
            triggers={triggers}
            onTriggers={(next) => setTriggers(sortTriggers(next))}
            postAs={postAs}
            onPostAs={setPostAs}
            failOn={agent.ci_fail_on}
          />
        )}
        {step === 3 && (
          <InstallStep
            repo={repo}
            pendingAction={pendingAction}
            onInstall={install}
            result={result}
            error={error}
            onRetry={lastAction && error ? () => install(lastAction) : null}
          />
        )}

        <div style={s.footer}>
          {step > 0 && !result && (
            <Button
              kind="ghost"
              icon="ChevronLeft"
              disabled={busy}
              onClick={() => (step === 2 ? leaveConfigure(false) : go(step - 1))}
            >
              {t("back")}
            </Button>
          )}
          <div style={s.spacer}>
            {step === 0 && (
              <Button
                kind="primary"
                iconRight="ArrowRight"
                disabled={!repo || unsupportedProvider || busy}
                onClick={continueFromTarget}
              >
                {t("continue")}
              </Button>
            )}
            {step === 1 && (
              <Button kind="primary" iconRight="ArrowRight" disabled={busy || askRegenerate} onClick={() => go(2)}>
                {t("continue")}
              </Button>
            )}
            {step === 2 && (
              <Button
                kind="primary"
                iconRight="ArrowRight"
                disabled={triggers.length === 0 || busy}
                onClick={() => leaveConfigure(true)}
              >
                {t("continue")}
              </Button>
            )}
            {step === 3 && result && (
              <Button kind="primary" icon="Check" onClick={onClose}>
                {t("done")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </EvalDialog>
  );
}
