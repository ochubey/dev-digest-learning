/* hooks/ci.ts — React Query hooks for Export to CI (SPEC-05): an agent's CI view, the CI Runs
   list, the GitHub Actions sync, and the wizard's preview / export calls. Types only from the
   shared contracts (see client INSIGHTS). */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CiAgentView,
  CiExport,
  CiExportInputBody,
  CiPreview,
  CiRunsList,
  CiSyncResult,
} from "@devdigest/shared";
import { api } from "../api";

export const ciKeys = {
  all: ["ci"] as const,
  agent: (agentId: string | null | undefined) => ["ci", "agent", agentId] as const,
  runs: ["ci", "runs"] as const,
};

/** `GET /agents/:id/ci` — installations plus the agent's 20 latest CI runs. */
export function useAgentCi(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ciKeys.agent(agentId),
    queryFn: () => api.get<CiAgentView>(`/agents/${agentId}/ci`),
    enabled: !!agentId,
  });
}

/** `GET /ci/runs` — the workspace's 100 newest CI runs. */
export function useCiRuns() {
  return useQuery({
    queryKey: ciKeys.runs,
    queryFn: () => api.get<CiRunsList>("/ci/runs"),
  });
}

/** `POST /ci/sync` (no body). On success every CI query is refetched. Callers fire it once on mount. */
export function useCiSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiSyncResult>("/ci/sync"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ciKeys.all });
    },
  });
}

/** `POST /agents/:id/export-ci/preview` — the generated files, nothing is written. */
export function useCiPreview(agentId: string | null | undefined) {
  return useMutation({
    mutationFn: (input: CiExportInputBody) => api.post<CiPreview>(`/agents/${agentId}/export-ci/preview`, input),
  });
}

/** `POST /agents/:id/export-ci` — opens the PR or returns the zip. Refreshes the CI views. */
export function useCiExport(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) => api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ciKeys.all });
    },
  });
}
