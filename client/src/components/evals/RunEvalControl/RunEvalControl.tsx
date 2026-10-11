"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { evalKeys, useAgentEvalRuns, useStartEvalRun } from "@/lib/hooks/evals";
import { findRunning } from "./helpers";
import { s } from "./styles";

export interface RunEvalControlProps {
  agentId: string | null | undefined;
  /** Number of eval cases the run will execute. */
  caseCount: number;
  /** Model name shown in the confirm step. */
  model: string;
  /** Extra reason to disable the action (e.g. data still loading). */
  disabled?: boolean;
}

/** AC-49/50/56/57: "Run all evals" with a confirm step, live progress and error handling. */
export function RunEvalControl({ agentId, caseCount, model, disabled = false }: RunEvalControlProps) {
  const t = useTranslations("evalsShared");
  const qc = useQueryClient();
  const runs = useAgentEvalRuns(agentId);
  const start = useStartEvalRun(agentId);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const running = findRunning(runs.data?.pages);
  const busy = start.isPending || !!running;
  const noCases = caseCount <= 0;

  const run = () => {
    setConfirming(false);
    setError(null);
    start.mutate(undefined, {
      onError: (e) => {
        if (e instanceof ApiError && e.status === 409) {
          // Another run is already going: show its progress instead of an error.
          void qc.invalidateQueries({ queryKey: evalKeys.runs(agentId) });
          return;
        }
        setError(e instanceof Error && e.message ? e.message : t("run.errorFallback"));
      },
    });
  };

  return (
    <div style={s.wrap}>
      <Button
        kind="primary"
        icon="Play"
        data-testid="eval-run-button"
        disabled={disabled || busy || noCases || confirming}
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        {t("run.button")}
      </Button>
      {noCases && <p style={s.text}>{t("run.noCases")}</p>}
      {confirming && (
        <div style={s.confirm} role="group" aria-label={t("run.button")}>
          <p style={s.text}>{t("run.confirm", { count: caseCount, model })}</p>
          <div style={s.actions}>
            <Button kind="primary" size="sm" onClick={run}>
              {t("run.confirmRun")}
            </Button>
            <Button size="sm" onClick={() => setConfirming(false)}>
              {t("run.confirmCancel")}
            </Button>
          </div>
        </div>
      )}
      <div role="status" aria-live="polite">
        {running ? (
          <p style={s.text}>{t("run.progress", { done: running.cases_done, total: running.cases_total })}</p>
        ) : start.isPending ? (
          <p style={s.text}>{t("run.starting")}</p>
        ) : null}
      </div>
      {error && (
        <p style={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
