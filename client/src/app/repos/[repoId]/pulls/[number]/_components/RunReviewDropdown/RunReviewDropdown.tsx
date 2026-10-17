/* RunReviewDropdown — ported from components2.jsx.
   "Run all enabled agents" / a specific agent → kicks off POST /pulls/:id/review
   and hands the resulting runIds up so the parent can stream SSE live status. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Icon, type DropdownItemDef } from "@devdigest/ui";
import { useAgents } from "../../../../../../../lib/hooks/agents";
import { useRunReview } from "../../../../../../../lib/hooks/reviews";
import { useLaunchMultiAgent, useMultiAgentEstimates } from "../../../../../../../lib/hooks/multi-agent";
import { ApiError } from "../../../../../../../lib/api";
import { notify } from "../../../../../../../lib/toast";
import { MAX_AGENTS } from "../../../../multi-agent/_components/ConfigureRun/constants";
import {
  configureRunHref,
  resultsHref,
} from "../../../../multi-agent/_components/ConfigureRun/helpers";
import { DROPDOWN_WIDTH } from "./constants";
import { pickEstimateLabel } from "./helpers";
import { s } from "./styles";

export function RunReviewDropdown({
  prId,
  repoId,
  prNumber,
  size = "sm",
  kind = "primary",
  warnMerged = false,
  onRunStart,
  onRunsStarted,
  onRunSettled,
}: {
  prId: string;
  /** With `prNumber`, enables the inline multi-agent picker. */
  repoId?: string;
  prNumber?: number;
  size?: "sm" | "md" | "lg";
  kind?: "primary" | "secondary";
  /** PR is already merged/closed — dim the trigger and warn, but still allow. */
  warnMerged?: boolean;
  /** Fired the moment a run is kicked off (before it completes). */
  onRunStart?: () => void;
  onRunsStarted?: (runIds: string[]) => void;
  /** Fired when the run request settles (success or error). */
  onRunSettled?: () => void;
}) {
  const t = useTranslations("prReview");
  const router = useRouter();
  const { data: agents } = useAgents();
  const run = useRunReview();
  const launch = useLaunchMultiAgent();
  const { data: estimates } = useMultiAgentEstimates();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<string[]>([]);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const all = agents ?? [];
  const hasEnabled = all.some((a) => a.enabled);

  const kick = async (opts: { all?: boolean; agentId?: string }) => {
    onRunStart?.();
    try {
      const res = await run.mutateAsync({ prId, ...opts });
      onRunsStarted?.(res.runs.map((r) => r.run_id));
    } finally {
      onRunSettled?.();
    }
  };

  const enabledAgents = all.filter((a) => a.enabled);
  const canPick = !!repoId && prNumber != null;
  const atLimit = picked.length >= MAX_AGENTS;
  const estById = new Map((estimates ?? []).map((e) => [e.agent_id, e]));
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => (on ? [...p.filter((x) => x !== id), id] : p.filter((x) => x !== id)));

  const launchPicked = () => {
    if (!repoId || picked.length < 2 || launch.isPending) return;
    launch.mutate(
      { prId, agentIds: picked },
      {
        onSuccess: (res) => {
          setOpen(false);
          router.push(
            res.multi_agent_run_id
              ? resultsHref(repoId, res.multi_agent_run_id)
              : `/repos/${repoId}/pulls/${prNumber}`,
          );
        },
        onError: (err) => notify.error(err instanceof ApiError ? err.message : String(err)),
      },
    );
  };

  // List EVERY agent (not just enabled) so they're always visible; a specific
  // agent can be run regardless of its enabled flag. "Run all" still targets
  // only enabled agents.
  const agentItems: DropdownItemDef[] = all.length
    ? all.map((a) => ({
        label: a.name,
        icon: "Cpu" as const,
        hint: a.enabled ? a.model : `${a.model} · disabled`,
        onClick: () => kick({ agentId: a.id }),
      }))
    : [{ label: "No agents yet — create one", icon: "Plus", muted: true, onClick: () => router.push("/agents") }];

  const items: DropdownItemDef[] = [
    // Merged/closed PRs can still be reviewed (informational only); lead with a
    // muted, non-actionable warning so the intent is clear.
    ...(warnMerged
      ? [
          { label: t("runReview.mergedWarning"), icon: "AlertTriangle" as const, muted: true },
          { divider: true } as DropdownItemDef,
        ]
      : []),
    {
      label: t("runReview.runAll"),
      icon: "Play",
      ...(hasEnabled ? {} : { muted: true }),
      onClick: () => kick({ all: true }),
    },
    { divider: true },
    ...agentItems,
    // With the inline picker the footer "Configure agents…" link replaces this item.
    ...(canPick
      ? []
      : [
          { divider: true } as DropdownItemDef,
          { label: t("runReview.configureAgents"), icon: "Settings" as const, muted: true, onClick: () => router.push("/agents") },
        ]),
  ];

  return (
    <div ref={ref} style={s.root}>
      <div onClick={() => setOpen((o) => !o)}>
        <span
          title={warnMerged ? t("runReview.mergedTooltip") : undefined}
          style={warnMerged ? { opacity: 0.6 } : undefined}
        >
          <Button kind={kind} size={size} iconRight="ChevronDown" icon="Sparkles" loading={run.isPending}>
            {run.isPending ? t("runReview.running") : t("runReview.runReview")}
          </Button>
        </span>
      </div>
      {open && (
        <div style={{ ...s.panel, width: DROPDOWN_WIDTH }}>
          {items.map((it, i) => {
            if (it.divider) return <div key={i} style={s.divider} />;
            const I = it.icon ? Icon[it.icon] : null;
            return (
              <button
                key={i}
                type="button"
                style={s.item(!!it.muted)}
                onClick={() => {
                  it.onClick?.();
                  setOpen(false);
                }}
              >
                {I && <I size={14} style={s.itemIcon} />}
                <span style={s.itemLabel}>
                  <span style={s.itemName}>{it.label}</span>
                  {it.hint && <span style={s.itemSub}>{it.hint}</span>}
                </span>
              </button>
            );
          })}
          {canPick && (
            <>
              <div style={s.divider} />
              <div style={s.pickHead}>
                <span style={s.pickTitle}>{t("runReview.pickAgents")}</span>
                {picked.length > 0 && (
                  <button type="button" style={s.link} onClick={() => setPicked([])}>
                    {t("runReview.clear")}
                  </button>
                )}
              </div>
              {enabledAgents.map((a) => {
                const checked = picked.includes(a.id);
                const est = pickEstimateLabel(estById.get(a.id));
                return (
                  <label key={a.id} style={s.pickRow}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={atLimit && !checked}
                      onChange={(e) => toggle(a.id, e.target.checked)}
                    />
                    <Icon.Cpu size={14} style={s.itemIcon} />
                    <span style={s.itemLabel}>
                      <span style={s.itemName}>{a.name}</span>
                    </span>
                    {est && <span style={s.itemHint}>{est}</span>}
                  </label>
                );
              })}
              <div style={s.pickRun}>
                <Button
                  kind="primary"
                  size="sm"
                  icon="Users"
                  loading={launch.isPending}
                  disabled={picked.length < 2}
                  onClick={launchPicked}
                >
                  {t("runReview.runMulti", { count: picked.length })}
                </Button>
              </div>
              <button
                type="button"
                style={s.footerLink}
                onClick={() => {
                  setOpen(false);
                  router.push(configureRunHref(repoId!, { pr: prNumber, agents: picked }));
                }}
              >
                {t("runReview.configureRun")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
