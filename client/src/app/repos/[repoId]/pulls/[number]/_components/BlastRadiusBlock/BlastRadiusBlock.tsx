"use client";

import React, { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Card, Skeleton, ErrorState, EmptyState, Icon } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/blast";
import { BlastGraph } from "./BlastGraph";
import { SYMBOLS_INITIAL } from "./constants";
import { blastCounts, canResync, degradedReasonKey, splitSymbols } from "./helpers";
import { IdleSymbols } from "./IdleSymbols";
import { PriorPrs } from "./PriorPrs";
import { ResyncButton } from "./ResyncButton";
import { SymbolRow } from "./SymbolRow";
import { s } from "./styles";

interface BlastRadiusBlockProps {
  prId: string;
  repoId?: string | null;
  repoFullName?: string | null;
  headSha?: string | null;
}

export function BlastRadiusBlock({ prId, repoId, repoFullName, headSha }: BlastRadiusBlockProps) {
  const t = useTranslations("blast");
  const { data, isLoading, error, refetch } = useBlastRadius(prId);
  const onResynced = useCallback(() => void refetch(), [refetch]);
  const [view, setView] = useState<"tree" | "graph">("tree");
  const [showAll, setShowAll] = useState(false);

  if (isLoading) {
    return (
      <Card style={s.wrap}>
        <SectionLabel icon="Code">{t("title")}</SectionLabel>
        <div style={s.loadingWrap}>
          <Skeleton width="60%" height={16} />
          <Skeleton width="100%" height={14} />
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card style={s.wrap}>
        <SectionLabel icon="Code">{t("title")}</SectionLabel>
        <ErrorState
          title={t("loadError")}
          body={t("loadErrorBody")}
          onRetry={() => void refetch()}
        />
      </Card>
    );
  }

  const degradedNode = data.degraded ? (
    <div data-testid="blast-degraded" role="note" style={s.degraded}>
      <Icon.AlertTriangle size={13} />
      <span>
        <strong>{t("degraded.title")}</strong> {t(`degraded.${degradedReasonKey(data.reason)}`)}
      </span>
      {repoId && canResync(data.reason) && <ResyncButton repoId={repoId} onDone={onResynced} />}
    </div>
  ) : null;

  if (data.changed_symbols.length === 0) {
    return (
      <Card style={s.wrap}>
        <SectionLabel icon="Code">{t("title")}</SectionLabel>
        {degradedNode}
        {!data.degraded && <EmptyState icon="Info" title={t("empty")} />}
      </Card>
    );
  }

  const counts = blastCounts(data.changed_symbols.length, data.downstream);
  const { active, idle } = splitSymbols(data.downstream);
  const visible = showAll ? active : active.slice(0, SYMBOLS_INITIAL);

  return (
    <Card style={s.wrap}>
      <SectionLabel icon="Code">{t("title")}</SectionLabel>
      {degradedNode}

      <div data-testid="blast-stats" style={s.statsRow}>
        {(["symbols", "callers", "endpoints", "crons"] as const).map((k) => (
          <span key={k} style={s.stat}>
            <span style={s.statNum}>{counts[k]}</span>
            {t(`stat.${k}`)}
          </span>
        ))}
        <div role="group" aria-label={t("title")} style={s.viewToggle}>
          {(["tree", "graph"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              style={{ ...s.viewBtn, ...(view === v ? s.viewBtnActive : null) }}
            >
              {t(`view.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {counts.callers === 0 && (
        <div data-testid="blast-no-downstream" style={s.summary}>
          {t("noDownstream", { count: counts.symbols })}
        </div>
      )}

      {view === "graph" ? (
        <BlastGraph downstream={data.downstream} />
      ) : (
        <div style={s.list}>
          {visible.map((d, i) => (
            <SymbolRow
              key={d.symbol}
              impact={d}
              defaultOpen={i === 0}
              repoFullName={repoFullName}
              headSha={headSha}
            />
          ))}
          {active.length > visible.length && (
            <button type="button" onClick={() => setShowAll(true)} style={s.showAll}>
              {t("showAll", { count: active.length })}
            </button>
          )}
          <IdleSymbols symbols={idle} />
        </div>
      )}

      <PriorPrs prId={prId} repoFullName={repoFullName} />
    </Card>
  );
}
