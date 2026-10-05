import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const post = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, api: { ...actual.api, post: (...a: unknown[]) => post(...a) } };
});

import { useRederiveIntent } from "./reviews";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => post.mockReset());

describe("useRederiveIntent", () => {
  it("posts { force: true } so a non-stale intent is re-derived", async () => {
    post.mockResolvedValue({});
    const { result } = renderHook(() => useRederiveIntent("pr1"), { wrapper });
    result.current.mutate();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/pulls/pr1/intent/derive", { force: true });
  });
});

describe("apiFetch 429 body", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("keeps retry_after from { error: string, retry_after } in ApiError.details", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: async () => ({ error: "Intent was derived recently", retry_after: 17 }),
    }) as unknown as typeof fetch;
    const { apiFetch, ApiError } = await vi.importActual<typeof import("../api")>("../api");
    const err = (await apiFetch("/x").catch((e: unknown) => e)) as InstanceType<typeof ApiError>;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.details).toEqual({ retry_after: 17 });
  });
});
