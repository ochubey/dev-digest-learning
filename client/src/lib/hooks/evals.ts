/* hooks/evals.ts — React Query hooks for the Eval Pipeline (SPEC-03): capturing a case from a
   decided finding, an agent's cases, starting/polling eval runs, the dashboard overview and
   the run comparison. Types come from the shared contracts (types only, see client INSIGHTS). */
"use client";

import React from "react";
import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  EvalCaseCreateInput,
  EvalCaseDraft,
  EvalCaseView,
  EvalCompare,
  EvalOverview,
  EvalRunPage,
  EvalRunStartResponse,
  EvalSuiteRunDetail,
} from "@devdigest/shared";
import { api } from "../api";

/** AC-50 requires <= 3 s; polling only runs while a run is `running`. */
export const EVAL_POLL_MS = 2000;
export const EVAL_RUNS_PAGE_SIZE = 20;

export const evalKeys = {
  all: ["evals"] as const,
  draft: (findingId: string | null | undefined) => ["evals", "draft", findingId] as const,
  cases: (agentId: string | null | undefined) => ["evals", "cases", agentId] as const,
  casesAll: ["evals", "cases"] as const,
  runs: (agentId: string | null | undefined) => ["evals", "runs", agentId] as const,
  run: (id: string | null | undefined) => ["evals", "run", id] as const,
  overview: ["evals", "overview"] as const,
  compare: (a: string | null | undefined, b: string | null | undefined) => ["evals", "compare", a, b] as const,
};

/** Read-only draft of a case for a decided finding (`GET /findings/:id/eval-case-draft`).
    A GET with no side effects, so it is a query; the dialog enables it on open. Never retried:
    a refusal (AC-11) is final until the user closes the dialog. */
export function useEvalCaseDraft(findingId: string | null | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: evalKeys.draft(findingId),
    queryFn: () => api.get<EvalCaseDraft>(`/findings/${findingId}/eval-case-draft`),
    enabled: !!findingId && (opts.enabled ?? true),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseCreateInput) => api.post<EvalCaseView>("/eval-cases", input),
    onSuccess: (_created, input) => {
      void qc.invalidateQueries({ queryKey: evalKeys.cases(input.agent_id) });
      void qc.invalidateQueries({ queryKey: evalKeys.overview });
      void qc.invalidateQueries({ queryKey: evalKeys.draft(input.finding_id) });
    },
  });
}

export function useAgentEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(agentId),
    queryFn: () => api.get<EvalCaseView[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: true }>(`/eval-cases/${caseId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalKeys.casesAll });
      void qc.invalidateQueries({ queryKey: evalKeys.overview });
    },
  });
}

/** Start a run for the agent (`mutate()` takes no argument). 202 returns the run id. */
export function useStartEvalRun(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalRunStartResponse>(`/agents/${agentId}/eval-runs`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalKeys.runs(agentId) });
    },
  });
}

const hasRunning = (pages: EvalRunPage[] | undefined) =>
  !!pages?.some((p) => p.items.some((r) => r.status === "running"));

/** The agent's runs, newest first, 20 per page. Polls every 2 s while any loaded run is
    `running`; when the last running run finishes it refreshes the cases and the overview so the
    metric strip, case results and dashboard update without a reload (AC-50). */
export function useAgentEvalRuns(agentId: string | null | undefined) {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: evalKeys.runs(agentId),
    queryFn: ({ pageParam }) => {
      const cursor = pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : "";
      return api.get<EvalRunPage>(`/agents/${agentId}/eval-runs?limit=${EVAL_RUNS_PAGE_SIZE}${cursor}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !!agentId,
    refetchInterval: (query) =>
      hasRunning(query.state.data?.pages) ? EVAL_POLL_MS : false,
  });

  const running = hasRunning(q.data?.pages);
  const wasRunning = React.useRef(false);
  React.useEffect(() => {
    if (wasRunning.current && !running) {
      void qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.overview });
    }
    wasRunning.current = running;
  }, [running, agentId, qc]);

  return q;
}

/** One run with its manifest and per-case results; polls while that run is still `running`. */
export function useEvalRun(id: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.run(id),
    queryFn: () => api.get<EvalSuiteRunDetail>(`/eval-runs/${id}`),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data?.status === "running" ? EVAL_POLL_MS : false),
  });
}

export function useEvalOverview() {
  return useQuery({
    queryKey: evalKeys.overview,
    queryFn: () => api.get<EvalOverview>("/evals/overview"),
  });
}

/** Two runs side by side; the server orders them (`a` is the older). */
export function useEvalCompare(a: string | null | undefined, b: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(a, b),
    queryFn: () =>
      api.get<EvalCompare>(`/eval-runs/compare?a=${encodeURIComponent(a ?? "")}&b=${encodeURIComponent(b ?? "")}`),
    enabled: !!a && !!b,
  });
}
