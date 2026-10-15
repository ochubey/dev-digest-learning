import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CiExportInputBody } from "@devdigest/shared";

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

import { ciKeys, useAgentCi, useCiRuns, useCiSync, useCiExport, useCiPreview } from "./ci";

let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockReset();
  post.mockReset();
});

describe("ci hooks", () => {
  it("useAgentCi / useCiRuns GET the CI endpoints; useAgentCi is disabled without an id", async () => {
    get.mockResolvedValue({ installations: [], runs: [] });
    const { result } = renderHook(() => useAgentCi("a1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/agents/a1/ci");

    get.mockClear();
    renderHook(() => useAgentCi(undefined), { wrapper });
    expect(get).not.toHaveBeenCalled();

    get.mockResolvedValue({ runs: [], installations_count: 0 });
    const runs = renderHook(() => useCiRuns(), { wrapper });
    await waitFor(() => expect(runs.result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/ci/runs");
  });

  it("sync invalidates ci queries; export posts CiExportInput", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");

    post.mockResolvedValueOnce({ synced_at: "2026-10-11T10:00:00Z", seen: 0, ingested: 0, rejected: 0, failures: [] });
    const sync = renderHook(() => useCiSync(), { wrapper });
    await act(async () => {
      await sync.result.current.mutateAsync();
    });
    expect(post).toHaveBeenCalledWith("/ci/sync");
    expect(spy).toHaveBeenCalledWith({ queryKey: ciKeys.all });

    spy.mockClear();
    const input: CiExportInputBody = { repo: "acme/api", target: "gha", action: "open_pr", post_as: "github_review", triggers: ["opened"] };
    post.mockResolvedValueOnce({ installation: {}, files: [], pr_url: null });
    const exp = renderHook(() => useCiExport("a1"), { wrapper });
    await act(async () => {
      await exp.result.current.mutateAsync(input);
    });
    expect(post).toHaveBeenLastCalledWith("/agents/a1/export-ci", input);
    expect(spy).toHaveBeenCalledWith({ queryKey: ciKeys.all });
  });

  it("preview posts to the preview endpoint without invalidating", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    post.mockResolvedValueOnce({ files: [], slug: "s", workflow_version: 1, runner_version: "2" });
    const { result } = renderHook(() => useCiPreview("a1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ repo: "acme/api" });
    });
    expect(post).toHaveBeenCalledWith("/agents/a1/export-ci/preview", { repo: "acme/api" });
    expect(spy).not.toHaveBeenCalled();
  });
});
