"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { useRepoIntelStatus, useResyncRepoIntel } from "@/lib/hooks/repo-intel";
import { RESYNC_POLL_MAX_MS } from "./constants";
import { s } from "./styles";

interface ResyncButtonProps {
  repoId: string;
  /** Called once the resync has written a new index row (or on failure to wait further). */
  onDone: () => void;
}

/**
 * POST /repos/:id/resync, then poll the index state until `updatedAt` advances
 * (resync is an async job: the 202 only means "queued") and ask the caller to refetch.
 */
export function ResyncButton({ repoId, onDone }: ResyncButtonProps) {
  const t = useTranslations("blast");
  const resync = useResyncRepoIntel(repoId);
  const [waiting, setWaiting] = useState(false);
  const [baseline, setBaseline] = useState<string | null>(null);
  const status = useRepoIntelStatus(repoId, waiting);
  const updatedAt = status.data?.updatedAt;

  useEffect(() => {
    if (waiting && updatedAt !== undefined && updatedAt !== baseline) {
      setWaiting(false);
      onDone();
    }
  }, [waiting, updatedAt, baseline, onDone]);

  useEffect(() => {
    if (!waiting) return;
    const id = setTimeout(() => setWaiting(false), RESYNC_POLL_MAX_MS);
    return () => clearTimeout(id);
  }, [waiting]);

  const start = () => {
    setBaseline(updatedAt ?? null);
    setWaiting(true);
    resync.mutate(undefined, { onError: () => setWaiting(false) });
  };

  return (
    <span style={s.resyncWrap}>
      <Button kind="secondary" size="sm" icon="RefreshCw" loading={waiting} onClick={start}>
        {waiting ? t("degraded.resyncing") : t("degraded.resync")}
      </Button>
      {resync.isError && (
        <span role="alert" style={s.resyncError}>
          {t("degraded.resyncFailed")}
        </span>
      )}
    </span>
  );
}
