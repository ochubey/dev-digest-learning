"use client";

import React, { useCallback } from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Card, Skeleton, ErrorState, EmptyState, Icon } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/blast";
import { blastCounts, canResync, degradedReasonKey } from "./helpers";
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
      </div>

      {counts.callers === 0 && (
        <div data-testid="blast-no-downstream" style={s.summary}>
          {t("noDownstream", { count: counts.symbols })}
        </div>
      )}

      <div style={s.list}>
        {data.downstream.map((d, i) => (
          <SymbolRow
            key={d.symbol}
            impact={d}
            defaultOpen={i === 0}
            repoFullName={repoFullName}
            headSha={headSha}
          />
        ))}
      </div>
    </Card>
  );
}
