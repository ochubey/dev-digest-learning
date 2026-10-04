/* hooks/blast.ts — React Query hook for the Blast Radius of a PR. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadius, PrHistory } from "@devdigest/shared";

/** Route response: the shared contract plus the repo-intel degradation flags.
   Type-only mirror of the server's `BlastResponseSchema` (server/src/modules/blast/build.ts);
   `client/src/vendor/shared` is read-only, so keep the two in step by hand. */
export type BlastResponse = BlastRadius & { degraded: boolean; reason: string | null };

/** Changed symbols, callers and affected endpoints/crons. Keyed under ["reviews", prId]
   like smart-diff so review invalidations refresh it. */
export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["reviews", prId, "blast"],
    queryFn: () => api.get<BlastResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/** Recent merged PRs touching the same files (GitHub-backed scan window, not full history).
   An error means "could not check"; no retries, GitHub failures are usually rate limit/auth. */
export function usePrHistory(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["reviews", prId, "history"],
    queryFn: () => api.get<PrHistory>(`/pulls/${prId}/history`),
    enabled: !!prId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
