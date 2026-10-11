/* ConfigureRun — pick a PR and 1..5 agents, see the estimate, start a multi-agent run.
   State in the URL: ?pr=<number>&agents=<id,id>. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, EmptyState } from "@devdigest/ui";
import { useAgents } from "@/lib/hooks/agents";
import { usePulls } from "@/lib/hooks/core";
import { useLaunchMultiAgent, useMultiAgentEstimates } from "@/lib/hooks/multi-agent";
import { ApiError } from "@/lib/api";
import { notify } from "@/lib/toast";
import { MAX_AGENTS } from "./constants";
import {
  agentEstimateLabel,
  configureRunHref,
  defaultSelection,
  formatSeconds,
  formatUsd,
  resultsHref,
  runButtonState,
  selectionEstimate,
  sortPullsNewestFirst,
} from "./helpers";
import { AgentPickCard } from "./AgentPickCard";
import { s } from "./styles";

export function ConfigureRun({ repoId }: { repoId: string }) {
  const t = useTranslations("multiAgent");
  const tPr = useTranslations("prReview");
  const router = useRouter();
  const search = useSearchParams();
  const { data: pulls } = usePulls(repoId);
  const { data: agents } = useAgents();
  const { data: estimates } = useMultiAgentEstimates();
  const launch = useLaunchMultiAgent();

  const prParam = search.get("pr");
  const presetIds = React.useMemo(
    () => (search.get("agents") ?? "").split(",").filter(Boolean),
    [search],
  );
  const sortedPulls = React.useMemo(() => sortPullsNewestFirst(pulls ?? []), [pulls]);
  const pr = sortedPulls.find((p) => String(p.number) === prParam) ?? null;
  const allAgents = agents ?? [];

  // null = untouched: the selection follows the defaults until the user changes it.
  const [picked, setPicked] = React.useState<string[] | null>(null);
  const selected = picked ?? defaultSelection(allAgents, presetIds);
  const selectedSet = new Set(selected);
  const atLimit = selected.length >= MAX_AGENTS;
  const estById = new Map((estimates ?? []).map((e) => [e.agent_id, e]));

  const choose = (ids: string[]) => setPicked(allAgents.filter((a) => ids.includes(a.id)).map((a) => a.id));
  const toggle = (id: string, on: boolean) =>
    choose(on ? [...selected, id] : selected.filter((x) => x !== id));
  const selectAll = () => choose(allAgents.slice(0, MAX_AGENTS).map((a) => a.id));
  const showClear = atLimit || (allAgents.length > 0 && selected.length === allAgents.length);

  const changePr = (value: string) => {
    router.replace(
      configureRunHref(repoId, { pr: value ? Number(value) : null, agents: presetIds }),
    );
  };

  const state = runButtonState(selected.length);
  const buttonLabel =
    state === "select"
      ? t("configure.runSelect")
      : state === "one"
        ? t("configure.runOne")
        : t("configure.runMany", { count: selected.length });

  const est = selectionEstimate(selected, estimates ?? []);
  const noneHaveHistory = est.withoutHistory === selected.length;

  const run = () => {
    if (!pr?.id || selected.length === 0 || launch.isPending) return;
    launch.mutate(
      { prId: pr.id, agentIds: selected },
      {
        onSuccess: (res) =>
          router.push(
            res.multi_agent_run_id
              ? resultsHref(repoId, res.multi_agent_run_id)
              : `/repos/${repoId}/pulls/${pr.number}`,
          ),
        onError: (err) => notify.error(err instanceof ApiError ? err.message : String(err)),
      },
    );
  };

  return (
    <div style={s.page}>
      <h1 style={s.title}>{t("configure.title")}</h1>

      <div style={s.field}>
        <label htmlFor="multi-agent-pr" style={s.label}>
          {t("configure.prLabel")}
        </label>
        <select
          id="multi-agent-pr"
          style={s.select}
          value={pr ? String(pr.number) : ""}
          onChange={(e) => changePr(e.target.value)}
        >
          <option value="">{t("configure.prPlaceholder")}</option>
          {sortedPulls.map((p) => (
            <option key={p.number} value={String(p.number)}>
              {t("configure.prOption", { number: p.number, title: p.title })}
            </option>
          ))}
        </select>
      </div>

      {!pr ? (
        <EmptyState icon="GitPullRequest" title={t("configure.pickPrFirst")} />
      ) : (
        <div style={s.field}>
          <div style={s.agentsHead}>
            <span style={s.label}>{t("configure.agentsLabel")}</span>
            <span style={s.agentsActions}>
              {atLimit && <span style={s.hint}>{t("configure.limitHint")}</span>}
              {showClear ? (
                <Button kind="ghost" size="sm" onClick={() => setPicked([])}>
                  {t("configure.clearAll")}
                </Button>
              ) : (
                <Button kind="ghost" size="sm" onClick={selectAll}>
                  {t("configure.selectAll")}
                </Button>
              )}
            </span>
          </div>
          <div style={s.cards}>
            {allAgents.map((a) => {
              const checked = selectedSet.has(a.id);
              return (
                <AgentPickCard
                  key={a.id}
                  agent={a}
                  checked={checked}
                  disabled={atLimit && !checked}
                  estimate={agentEstimateLabel(estById.get(a.id)) ?? t("configure.noHistory")}
                  disabledLabel={t("configure.disabled")}
                  onChange={(on) => toggle(a.id, on)}
                />
              );
            })}
          </div>
        </div>
      )}

      <div style={s.footer}>
        <Button
          kind="primary"
          icon="Users"
          loading={launch.isPending}
          disabled={!pr || selected.length === 0}
          onClick={run}
        >
          {buttonLabel}
        </Button>
        {pr && selected.length > 0 && (
          <span style={s.estimate}>
            {noneHaveHistory
              ? t("configure.noHistory")
              : t("configure.estimate", {
                  seconds: formatSeconds(est.seconds),
                  cost: formatUsd(est.cost),
                })}
            {est.withoutHistory > 0 &&
              !noneHaveHistory &&
              t("configure.withoutHistory", { count: est.withoutHistory })}
          </span>
        )}
        {pr && (pr.status === "merged" || pr.status === "closed") && (
          <span style={s.warning}>{tPr("runReview.mergedWarning")}</span>
        )}
      </div>
    </div>
  );
}
