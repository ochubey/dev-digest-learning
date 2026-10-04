"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Card, Skeleton, ErrorState, EmptyState, Icon } from "@devdigest/ui";
import { useBlastRadius } from "@/lib/hooks/blast";
import { blastCounts, callerHref, degradedReasonKey } from "./helpers";
import { s } from "./styles";

interface BlastRadiusBlockProps {
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
}

export function BlastRadiusBlock({ prId, repoFullName, headSha }: BlastRadiusBlockProps) {
  const t = useTranslations("blast");
  const { data, isLoading, error, refetch } = useBlastRadius(prId);

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
        {data.downstream.map((d) => (
          <div key={d.symbol} data-testid="blast-symbol">
            <div style={s.symbolHead}>
              <Icon.Code size={13} />
              {d.symbol}
              <span style={s.symbolCount}>{t("callerCount", { count: d.callers.length })}</span>
            </div>

            {d.callers.length === 0 ? (
              <div style={s.muted}>{t("noCallers")}</div>
            ) : (
              <div style={s.callers}>
                {d.callers.map((c) => {
                  const href = callerHref(repoFullName, headSha, c.file, c.line);
                  const label = `${c.file}:${c.line}`;
                  return (
                    <div key={`${c.file}:${c.line}:${c.name}`} style={s.callerRow}>
                      <Icon.CornerDownRight size={12} />
                      <span>{c.name}</span>
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" style={s.callerLink}>
                          {label}
                        </a>
                      ) : (
                        <span style={s.callerLink}>{label}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {(d.endpoints_affected.length > 0 || d.crons_affected.length > 0) && (
              <div style={s.chips}>
                {d.endpoints_affected.map((e) => (
                  <span key={`e:${e}`} data-testid="blast-endpoint" style={s.chip}>
                    <Icon.Globe size={12} />
                    {e}
                  </span>
                ))}
                {d.crons_affected.map((c) => (
                  <span key={`c:${c}`} data-testid="blast-cron" style={s.chip}>
                    <Icon.Clock size={12} />
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
