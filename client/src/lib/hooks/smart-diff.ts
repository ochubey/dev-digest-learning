/* hooks/smart-diff.ts — React Query hook for the Smart Diff role grouping. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiff } from "@devdigest/shared";

/** Files of a PR grouped by role. Keyed under ["reviews", prId] so every review
   invalidation also refreshes it (finding_lines derive from the latest reviews). */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["reviews", prId, "smart-diff"],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}
