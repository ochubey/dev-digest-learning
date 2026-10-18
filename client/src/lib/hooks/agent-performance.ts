/* hooks/agent-performance.ts — read-only hooks for the Agent Performance dashboard
   and the agent Stats tab (SPEC-06). GET only; no mutations live here. */
"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentStats } from "@devdigest/shared";
import { api } from "../api";
import type { AgentPerformance } from "../../components/agent-performance/types";
import type { Period } from "../../components/agent-performance/period";

const qs = (p: Period) => new URLSearchParams({ from: p.from, to: p.to }).toString();

export function useAgentPerformance(period: Period) {
  return useQuery({
    queryKey: ["agent-performance", period.from, period.to],
    queryFn: () => api.get<AgentPerformance>(`/agent-performance?${qs(period)}`),
  });
}

export function useAgentStats(id: string | null | undefined, period: Period) {
  return useQuery({
    queryKey: ["agent-stats", id, period.from, period.to],
    queryFn: () => api.get<AgentStats>(`/agents/${id}/stats?${qs(period)}`),
    enabled: !!id,
  });
}
