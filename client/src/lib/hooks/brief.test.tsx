import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
import { usePrBrief, useGenerateBrief, type BriefResponse } from "./brief";

let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  qc = new QueryClient();
});

describe("usePrBrief", () => {
  it("does not retry a 404 (empty state)", async () => {
    get.mockRejectedValue(new ApiError("nf", 404));
    const { result } = renderHook(() => usePrBrief("pr1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/pulls/pr1/brief");
  });
});

describe("useGenerateBrief", () => {
  it("sets the query data on success", async () => {
    const brief = { pr_id: "pr1", stale: false, summary: "s" } as unknown as BriefResponse;
    post.mockResolvedValue(brief);
    const { result } = renderHook(() => useGenerateBrief("pr1"), { wrapper });
    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(qc.getQueryData(["pr-brief", "pr1"])).toEqual(brief));
    expect(post).toHaveBeenCalledWith("/pulls/pr1/brief");
  });

  it("invalidates the brief query on a 429", async () => {
    post.mockRejectedValue(new ApiError("recent", 429, undefined, { retry_after: 5 }));
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useGenerateBrief("pr1"), { wrapper });
    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["pr-brief", "pr1"] });
  });

  it("does not invalidate on a 502", async () => {
    post.mockRejectedValue(new ApiError("bad", 502));
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useGenerateBrief("pr1"), { wrapper });
    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).not.toHaveBeenCalled();
  });
});
