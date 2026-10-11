/* hooks/multi-agent.ts — React Query hooks for Multi-Agent Review:
   estimates, launching a run over several agents, and the aggregate run view. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type { AgentRunEstimate, MultiAgentRun, ReviewRunResponse } from "@devdigest/shared";

/** Per-agent duration/cost estimates from past runs (GET /multi-agent/estimates). */
export function useMultiAgentEstimates() {
  return useQuery({
    queryKey: ["multi-agent-estimates"],
    queryFn: () => api.get<AgentRunEstimate[]>("/multi-agent/estimates"),
  });
}

/** Start one multi-agent run. `silent`: the caller toasts the error itself (providers.tsx). */
export function useLaunchMultiAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: { prId: string; agentIds: string[] }) =>
      api.post<ReviewRunResponse>(`/pulls/${prId}/review`, { agentIds }),
    meta: { silent: true },
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["reviews", prId] });
      qc.invalidateQueries({ queryKey: ["pr-runs", prId] });
      qc.invalidateQueries({ queryKey: ["pr-active-runs", prId] });
    },
  });
}

/** The aggregate view of one multi-agent run; polls every 4 s while a column is running. */
export function useMultiAgentRun(id: string | null | undefined) {
  return useQuery({
    queryKey: ["multi-agent-run", id],
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${id}`),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data?.columns.some((c) => c.status === "running") ? 4000 : false,
    // 404 = unknown run: a normal empty state, not worth retrying.
    retry: (failureCount, err) => !(err instanceof ApiError && err.status === 404) && failureCount < 1,
  });
}
