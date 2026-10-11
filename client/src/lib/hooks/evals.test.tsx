import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EvalRunPage, EvalSuiteRun } from "@devdigest/shared";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      del: (...a: unknown[]) => del(...a),
    },
  };
});

import {
  evalKeys,
  useAgentEvalRuns,
  useAgentEvalCases,
  useCreateEvalCase,
  useDeleteEvalCase,
  useEvalCaseDraft,
  useEvalCompare,
  useEvalOverview,
  useEvalRun,
  useStartEvalRun,
} from "./evals";

let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function mkRun(id: string, status: EvalSuiteRun["status"] = "completed"): EvalSuiteRun {
  return {
    id,
    agent_id: "a1",
    agent_version: 1,
    status,
    error: null,
    cases_total: 4,
    cases_done: status === "running" ? 1 : 4,
    metrics: { recall: null, precision: null, citation_accuracy: null },
    counts: null,
    duration_ms: null,
    cost_usd: null,
    started_at: "2026-10-11T10:00:00Z",
    finished_at: null,
  };
}
const page = (items: EvalSuiteRun[], next: string | null = null): EvalRunPage => ({ items, next_cursor: next });

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockReset();
  post.mockReset();
  del.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useAgentEvalRuns", () => {
  it("polls every 2 s while a run is running, then stops and invalidates cases + overview", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get
      .mockResolvedValueOnce(page([mkRun("r1", "running")]))
      .mockResolvedValueOnce(page([mkRun("r1", "running")]))
      .mockResolvedValue(page([mkRun("r1", "completed")]));
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useAgentEvalRuns("a1"), { wrapper });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(get).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(result.current.data?.pages[0]?.items[0]?.status).toBe("completed"));

    // finished: no more polling, and the dependent queries were invalidated once
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(get).toHaveBeenCalledTimes(3);
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(evalKeys.cases("a1")));
    expect(keys).toContain(JSON.stringify(evalKeys.overview));
  });

  it("does not poll or invalidate when nothing is running", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    get.mockResolvedValue(page([mkRun("r1")]));
    const spy = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useAgentEvalRuns("a1"), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it("pages of 20 with the cursor", async () => {
    get
      .mockResolvedValueOnce(page([mkRun("r1")], "cur1"))
      .mockResolvedValueOnce(page([mkRun("r2")], null));
    const { result } = renderHook(() => useAgentEvalRuns("a1"), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(get).toHaveBeenLastCalledWith("/agents/a1/eval-runs?limit=20");
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(get).toHaveBeenLastCalledWith("/agents/a1/eval-runs?limit=20&cursor=cur1");
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(result.current.data?.pages.flatMap((p) => p.items).map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("is disabled without an agent id", () => {
    renderHook(() => useAgentEvalRuns(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("case hooks", () => {
  it("draft fetches only when enabled", async () => {
    get.mockResolvedValue({ finding_id: "f1" });
    const { rerender, result } = renderHook(({ on }) => useEvalCaseDraft("f1", { enabled: on }), {
      wrapper,
      initialProps: { on: false },
    });
    expect(get).not.toHaveBeenCalled();
    rerender({ on: true });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(get).toHaveBeenCalledWith("/findings/f1/eval-case-draft");
  });

  it("lists the agent's cases", async () => {
    get.mockResolvedValue([]);
    const { result } = renderHook(() => useAgentEvalCases("a1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/agents/a1/eval-cases");
  });

  it("create posts the body and invalidates that agent's cases + overview + the draft", async () => {
    post.mockResolvedValue({ id: "c1" });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateEvalCase(), { wrapper });
    const body = {
      agent_id: "a1",
      finding_id: "f1",
      name: "n",
      expectation: { kind: "must_find" as const, file: "a.ts", start_line: 1, end_line: 2 },
      input_diff: "d",
    };
    await act(async () => {
      await result.current.mutateAsync(body);
    });
    expect(post).toHaveBeenCalledWith("/eval-cases", body);
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(evalKeys.cases("a1")));
    expect(keys).toContain(JSON.stringify(evalKeys.overview));
    expect(keys).toContain(JSON.stringify(evalKeys.draft("f1")));
  });

  it("a failing create rejects and invalidates nothing", async () => {
    post.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCreateEvalCase(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          agent_id: "a1",
          finding_id: "f1",
          name: "n",
          expectation: { kind: "must_find", file: "a", start_line: 1, end_line: 1 },
          input_diff: "d",
        }),
      ).rejects.toThrow("boom");
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("delete calls DELETE and invalidates cases + overview", async () => {
    del.mockResolvedValue({ ok: true });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useDeleteEvalCase(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("c1");
    });
    expect(del).toHaveBeenCalledWith("/eval-cases/c1");
    expect(spy).toHaveBeenCalled();
  });
});

describe("run hooks", () => {
  it("start posts to the agent's eval-runs and refreshes its runs", async () => {
    post.mockResolvedValue({ run_id: "r9" });
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useStartEvalRun("a1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(post).toHaveBeenCalledWith("/agents/a1/eval-runs");
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(evalKeys.runs("a1")));
  });

  it("run detail, overview and compare hit their endpoints", async () => {
    get.mockResolvedValue({});
    renderHook(() => useEvalRun("r1"), { wrapper });
    renderHook(() => useEvalOverview(), { wrapper });
    renderHook(() => useEvalCompare("x", "y"), { wrapper });
    renderHook(() => useEvalCompare("x", null), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    const urls = get.mock.calls.map((c) => c[0]).sort();
    expect(urls).toEqual(["/eval-runs/compare?a=x&b=y", "/eval-runs/r1", "/evals/overview"]);
  });
});
