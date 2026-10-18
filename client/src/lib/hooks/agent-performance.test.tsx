import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import sample from "@/test/fixtures/agent-performance.sample.json";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const patch = vi.fn();
const del = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      put: (...a: unknown[]) => put(...a),
      patch: (...a: unknown[]) => patch(...a),
      del: (...a: unknown[]) => del(...a),
    },
  };
});

import { useAgentPerformance, useAgentStats } from "./agent-performance";
import { useAgentPerformance as viaBarrel } from "./index";

let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const PERIOD = { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" };

function queryOf(url: string) {
  const [path, qs] = url.split("?");
  return { path, q: Object.fromEntries(new URLSearchParams(qs)) };
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const m of [get, post, put, patch, del]) m.mockReset();
});

describe("agent-performance hooks", () => {
  it("is re-exported from the hooks barrel", () => {
    expect(viaBarrel).toBe(useAgentPerformance);
  });

  it("useAgentPerformance GETs /agent-performance with exactly the period", async () => {
    get.mockResolvedValue(sample);
    const { result } = renderHook(() => useAgentPerformance(PERIOD), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect(queryOf(get.mock.calls[0]![0] as string)).toEqual({ path: "/agent-performance", q: PERIOD });
    expect(qc.getQueryCache().find({ queryKey: ["agent-performance", PERIOD.from, PERIOD.to] })).toBeDefined();
  });

  it("useAgentStats GETs /agents/:id/stats with the period", async () => {
    get.mockResolvedValue(sample.agents[0]);
    const { result } = renderHook(() => useAgentStats("ag-1", PERIOD), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryOf(get.mock.calls[0]![0] as string)).toEqual({ path: "/agents/ag-1/stats", q: PERIOD });
  });

  it("useAgentStats stays idle without an agent id", () => {
    renderHook(() => useAgentStats(undefined, PERIOD), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });

  it("a new period is a new request; no write method is ever used", async () => {
    get.mockResolvedValue(sample);
    const { rerender } = renderHook(({ p }) => useAgentPerformance(p), { wrapper, initialProps: { p: PERIOD } });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    rerender({ p: { from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" } });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    for (const m of [post, put, patch, del]) expect(m).not.toHaveBeenCalled();
  });
});
