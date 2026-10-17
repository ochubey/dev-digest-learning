import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentColumn, MultiAgentRun } from "@devdigest/shared";

const get = vi.fn();
const post = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
    },
  };
});

import { ApiError } from "../api";
import { useMultiAgentRun, useLatestMultiAgentRunForPr, useLaunchMultiAgent } from "./multi-agent";

let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function col(runId: string, status: AgentColumn["status"]): AgentColumn {
  return {
    run_id: runId,
    agent_id: `ag-${runId}`,
    agent_name: `Agent ${runId}`,
    provider: "openai",
    model: "gpt-4.1",
    status,
    error: null,
    verdict: null,
    score: status === "done" ? 80 : null,
    summary: null,
    duration_ms: status === "running" ? null : 1000,
    cost_usd: status === "running" ? null : 0.01,
    findings: [],
  };
}
function mkRun(statuses: AgentColumn["status"][]): MultiAgentRun {
  return {
    id: "m1",
    pr_id: "pr1",
    pr_number: 7,
    ran_at: "2026-10-11T10:00:00Z",
    agent_count: statuses.length,
    total_duration_ms: 1000,
    total_cost_usd: 0.02,
    columns: statuses.map((s, i) => col(`r${i}`, s)),
    conflicts: [],
    groups: [],
  };
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockReset();
  post.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useMultiAgentRun", () => {
  it("refetches every 4 s while a column is running (fake timers)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockResolvedValue(mkRun(["running", "done"]));
    renderHook(() => useMultiAgentRun("m1"), { wrapper });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenLastCalledWith("/multi-agent-runs/m1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3800);
    });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("stops refetching when all columns are terminal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get
      .mockResolvedValueOnce(mkRun(["running", "done"]))
      .mockResolvedValue(mkRun(["done", "failed"]));
    const { result } = renderHook(() => useMultiAgentRun("m1"), { wrapper });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.data?.columns[0]?.status).toBe("done"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("404 is not retried", async () => {
    // Use the hook's own retry policy: do not override it with retry:false.
    qc = new QueryClient();
    get.mockRejectedValue(new ApiError("Not found", 404));
    const { result } = renderHook(() => useMultiAgentRun("missing"), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect((result.current.error as ApiError).status).toBe(404);
  });
});

describe("useLatestMultiAgentRunForPr", () => {
  it("requests the PR-scoped latest run", async () => {
    get.mockResolvedValue({ id: "m9" });
    const { result } = renderHook(() => useLatestMultiAgentRunForPr("pr 1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ id: "m9" }));
    expect(get).toHaveBeenCalledWith("/multi-agent-runs/latest?prId=pr%201");
  });

  it("is disabled without a prId", () => {
    renderHook(() => useLatestMultiAgentRunForPr(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });

  it("is invalidated by a successful launch", async () => {
    post.mockResolvedValue({});
    get.mockResolvedValue({ id: null });
    const { result } = renderHook(
      () => ({ latest: useLatestMultiAgentRunForPr("pr1"), launch: useLaunchMultiAgent() }),
      { wrapper },
    );
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.launch.mutateAsync({ prId: "pr1", agentIds: ["a1", "a2"] });
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});
