import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { AgentContextAttachments, ContextDiscovery } from "@devdigest/shared";
import messages from "../../../messages/en/projectContext.json";

const get = vi.fn();
const put = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...a: unknown[]) => get(...a),
      put: (...a: unknown[]) => put(...a),
    },
  };
});

const notifyError = vi.fn();
vi.mock("../toast", () => ({
  notify: { error: (m: string) => notifyError(m), success: vi.fn(), info: vi.fn(), toast: vi.fn() },
}));

import { ApiError } from "../api";
import {
  useAgentContext,
  useSetAgentContext,
  useSkillContext,
  useSetSkillContext,
  useContextDocs,
  useReindexContextDocs,
  useDefaultContextRepo,
  useContextDocPreview,
} from "./project-context";

let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

const BASE: AgentContextAttachments = {
  paths: ["specs/a.md"],
  version: 1,
  inherited: [{ path: "docs/x.md", skill_id: "sk1", skill_name: "no-any" }],
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  notifyError.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe("read hooks", () => {
  it("useDefaultContextRepo / useContextDocs / useContextDocPreview hit the right endpoints", async () => {
    get.mockResolvedValue({});
    renderHook(() => useDefaultContextRepo(), { wrapper });
    renderHook(() => useContextDocs("r1"), { wrapper });
    renderHook(() => useContextDocPreview("r1", "specs/a.md"), { wrapper });
    renderHook(() => useAgentContext("ag1"), { wrapper });
    renderHook(() => useSkillContext("sk1"), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(5));
    const urls = get.mock.calls.map((c) => c[0]);
    expect(urls).toContain("/context/default-repo");
    expect(urls).toContain("/repos/r1/context/docs");
    expect(urls).toContain("/repos/r1/context/docs/preview?path=specs%2Fa.md");
    expect(urls).toContain("/agents/ag1/context");
    expect(urls).toContain("/skills/sk1/context");
  });

  it("queries stay idle without an id", () => {
    renderHook(() => useContextDocs(null), { wrapper });
    renderHook(() => useContextDocPreview("r1", null), { wrapper });
    renderHook(() => useAgentContext(undefined), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });

  it("preview does not retry a 404", async () => {
    get.mockRejectedValue(new ApiError("gone", 404));
    const { result } = renderHook(() => useContextDocPreview("r1", "specs/a.md"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("useReindexContextDocs", () => {
  it("fetches ?refresh=1 once and replaces the cached list", async () => {
    const fresh: ContextDiscovery = {
      repo_id: "r1",
      branch: "main",
      commit_sha: "abc",
      docs: [{ path: "specs/new.md", name: "new.md", folder: "specs", source: "specs", tokens: 10 }],
    };
    get.mockResolvedValue(fresh);
    const { result } = renderHook(() => useReindexContextDocs("r1"), { wrapper });
    await act(async () => {
      result.current.mutate();
    });
    await waitFor(() => expect(qc.getQueryData(["context-docs", "r1"])).toEqual(fresh));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/repos/r1/context/docs?refresh=1");
  });
});

describe("useSetAgentContext", () => {
  it("setter is optimistic and rolls back on error", async () => {
    qc.setQueryData(["agent-context", "ag1"], BASE);
    const d = deferred<AgentContextAttachments>();
    put.mockReturnValue(d.promise);
    const { result } = renderHook(() => useSetAgentContext("ag1"), { wrapper });

    act(() => {
      result.current.mutate(["specs/a.md", "specs/b.md"]);
    });
    // optimistic: visible before the response, inherited preserved
    await waitFor(() =>
      expect(qc.getQueryData<AgentContextAttachments>(["agent-context", "ag1"])?.paths).toEqual([
        "specs/a.md",
        "specs/b.md",
      ]),
    );
    expect(qc.getQueryData<AgentContextAttachments>(["agent-context", "ag1"])?.inherited).toEqual(
      BASE.inherited,
    );
    expect(put).toHaveBeenCalledWith("/agents/ag1/context", { paths: ["specs/a.md", "specs/b.md"] });

    d.reject(new ApiError("boom", 500));
    await waitFor(() => expect(result.current.isError).toBe(true));
    // rolled back to the snapshot, user told
    expect(qc.getQueryData<AgentContextAttachments>(["agent-context", "ag1"])?.paths).toEqual([
      "specs/a.md",
    ]);
    expect(notifyError).toHaveBeenCalledTimes(1);
    expect(notifyError.mock.calls[0]?.[0]).toMatch(/restored/i);
  });

  it("two rapid writes with delayed responses: final PUT payload equals last state, requests serialized", async () => {
    qc.setQueryData(["agent-context", "ag1"], BASE);
    const first = deferred<AgentContextAttachments>();
    const second = deferred<AgentContextAttachments>();
    put.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSetAgentContext("ag1"), { wrapper });

    act(() => {
      result.current.mutate(["specs/a.md", "specs/b.md"]);
      result.current.mutate(["specs/a.md", "specs/b.md", "docs/c.md"]);
    });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    // second request has not started while the first is in flight
    await new Promise((r) => setTimeout(r, 30));
    expect(put).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData<AgentContextAttachments>(["agent-context", "ag1"])?.paths).toEqual([
      "specs/a.md",
      "specs/b.md",
      "docs/c.md",
    ]);

    first.resolve({ ...BASE, paths: ["specs/a.md", "specs/b.md"], version: 2 });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[1]).toEqual([
      "/agents/ag1/context",
      { paths: ["specs/a.md", "specs/b.md", "docs/c.md"] },
    ]);
    // the stale first response must not clobber the newer optimistic state
    expect(qc.getQueryData<AgentContextAttachments>(["agent-context", "ag1"])?.paths).toEqual([
      "specs/a.md",
      "specs/b.md",
      "docs/c.md",
    ]);
    second.resolve({ ...BASE, paths: ["specs/a.md", "specs/b.md", "docs/c.md"], version: 3 });
    await waitFor(() =>
      expect(qc.getQueryData<AgentContextAttachments>(["agent-context", "ag1"])?.version).toBe(3),
    );
  });
});

describe("useSetSkillContext", () => {
  it("is optimistic, PUTs the full list and rolls back on error", async () => {
    qc.setQueryData(["skill-context", "sk1"], { paths: ["specs/a.md"], version: 1 });
    const d = deferred<{ paths: string[]; version: number }>();
    put.mockReturnValue(d.promise);
    const { result } = renderHook(() => useSetSkillContext("sk1"), { wrapper });
    act(() => {
      result.current.mutate([]);
    });
    await waitFor(() =>
      expect(qc.getQueryData<{ paths: string[] }>(["skill-context", "sk1"])?.paths).toEqual([]),
    );
    expect(put).toHaveBeenCalledWith("/skills/sk1/context", { paths: [] });
    d.reject(new ApiError("boom", 500));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<{ paths: string[] }>(["skill-context", "sk1"])?.paths).toEqual([
      "specs/a.md",
    ]);
  });
});
