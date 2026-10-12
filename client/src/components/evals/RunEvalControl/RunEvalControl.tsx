"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@devdigest/ui";
import type { Provider } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useProviderModels } from "@/lib/hooks/agents";
import { toModelOptions } from "@/lib/model-label";
import { evalKeys, useAgentEvalRuns, useStartEvalRun } from "@/lib/hooks/evals";
import { findRunning } from "./helpers";
import { s } from "./styles";

export interface RunEvalControlProps {
  agentId: string | null | undefined;
  /** Number of eval cases the run will execute. */
  caseCount: number;
  /** The agent's own model: the default for the run. */
  model: string;
  /** The agent's provider; the model choices come from it. */
  provider?: Provider | null;
  /** Extra reason to disable the action (e.g. data still loading). */
  disabled?: boolean;
}

/** AC-49/50/56/57: "Run all evals" with a confirm step, live progress and error handling. */
export function RunEvalControl({ agentId, caseCount, model, provider, disabled = false }: RunEvalControlProps) {
  const t = useTranslations("evalsShared");
  const qc = useQueryClient();
  const runs = useAgentEvalRuns(agentId);
  const start = useStartEvalRun(agentId);
  const [confirming, setConfirming] = React.useState(false);
  const [chosen, setChosen] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const { data: models } = useProviderModels(provider);
  const options = toModelOptions(models)
    .map((o) => (typeof o === "string" ? { value: o, label: o } : o))
    .filter((o) => o.value !== model);
  // Empty list after load = provider key missing/invalid; only the agent's model stays.
  const noModels = models !== undefined && models.length === 0;
  const runModel = chosen && chosen !== model ? chosen : model;

  const running = findRunning(runs.data?.pages);
  const busy = start.isPending || !!running;
  const noCases = caseCount <= 0;

  const run = () => {
    setConfirming(false);
    setError(null);
    start.mutate(chosen && chosen !== model ? { model: chosen } : undefined, {
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
          setChosen("");
          setConfirming(true);
        }}
      >
        {t("run.button")}
      </Button>
      {noCases && <p style={s.text}>{t("run.noCases")}</p>}
      {confirming && (
        <div style={s.confirm} role="group" aria-label={t("run.button")}>
          <label style={s.field}>
            <span style={s.text}>{t("run.modelLabel")}</span>
            <select style={s.select} value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">{t("run.modelDefault", { model })}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <p style={s.hint}>
            {noModels ? t("run.modelsEmptyHint", { provider: provider ?? "" }) : t("run.modelHint")}
          </p>
          <p style={s.text}>{t("run.confirm", { count: caseCount, model: runModel })}</p>
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
