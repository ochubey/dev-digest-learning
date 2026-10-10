/* hooks/brief.ts — React Query hooks for the PR Brief (GET/POST /pulls/:id/brief). */
"use client";

import { useSyncExternalStore } from "react";
import { useQuery, useMutation, useQueryClient, useIsMutating } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { PrBrief } from "@devdigest/shared";

/** Route response: the shared contract plus the PR id and staleness flag.
   Type-only mirror of the server's `BriefResponseSchema` (server/src/modules/brief/schema.ts);
   `client/src/vendor/shared` is read-only, so keep the two in step by hand. */
export type BriefResponse = PrBrief & { pr_id: string; stale: boolean };

export const prBriefKey = (prId: string | null | undefined) => ["pr-brief", prId] as const;

/** Stored brief, DB-only on the server. 404 = never generated: a normal empty state, no retry. */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: prBriefKey(prId),
    queryFn: () => api.get<BriefResponse>(`/pulls/${prId}/brief`),
    enabled: !!prId,
    retry: (failureCount, err) => !(err instanceof ApiError && err.status === 404) && failureCount < 1,
  });
}

export const generateBriefKey = (prId: string | null | undefined) => ["pr-brief-generate", prId] as const;

/** True while any brief generation for this PR is in flight, from any component instance. */
export function useIsGeneratingBrief(prId: string | null | undefined): boolean {
  return useIsMutating({ mutationKey: generateBriefKey(prId) }) > 0;
}

export const briefCooldownKey = (prId: string | null | undefined) => ["pr-brief-cooldown", prId] as const;

/** Epoch ms until which generation is rate limited for this PR (0 = not limited). Shared through
   the query cache, so every component instance (and a remount) agrees on it. */
export function useBriefCooldownEnd(prId: string | null | undefined): number {
  const qc = useQueryClient();
  return useSyncExternalStore(
    (cb) => qc.getQueryCache().subscribe(cb),
    () => qc.getQueryData<number>(briefCooldownKey(prId)) ?? 0,
    () => 0,
  );
}

/** Generate (or regenerate) the brief. A 429 means one was started recently (possibly by
   another tab), so refetch the stored one once. A 502 leaves the cached brief untouched. */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: generateBriefKey(prId),
    // The inline cooldown notice replaces the global error toast for a 429 (see providers.tsx).
    meta: { silent429: true },
    mutationFn: () => api.post<BriefResponse>(`/pulls/${prId}/brief`),
    onSuccess: (data) => {
      qc.setQueryData(prBriefKey(prId), data);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 429) {
        const v = (err.details as { retry_after?: unknown } | undefined)?.retry_after;
        const seconds = typeof v === "number" && v > 0 ? Math.ceil(v) : 1;
        qc.setQueryData(briefCooldownKey(prId), Date.now() + seconds * 1000);
        void qc.invalidateQueries({ queryKey: prBriefKey(prId) });
      }
    },
  });
}
