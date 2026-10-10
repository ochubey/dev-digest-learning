import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, Repo } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../../../messages/en/projectContext.json";
import { REPO_STORAGE_KEY } from "@/components/project-context";

const get = vi.fn();
const put = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) },
  };
});

import { ContextTab } from "./ContextTab";

const AGENT = { id: "ag1", name: "Sec" } as Agent;
const mkRepo = (id: string, full: string) => ({ id, full_name: full }) as Repo;

let repos: Repo[];
let defaultRepo: string | null;

function route() {
  get.mockImplementation(async (url: string) => {
    if (url === "/repos") return repos;
    if (url === "/context/default-repo") return { repo_id: defaultRepo };
    if (url.endsWith("/context/docs"))
      return { repo_id: url.split("/")[2], branch: "main", commit_sha: "abc", docs: [] };
    if (url === "/agents/ag1/context") return { paths: [], version: 1, inherited: [] };
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, projectContext: contextMessages }}>
      <QueryClientProvider client={qc}>
        <ContextTab agent={AGENT} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  window.localStorage.clear();
  repos = [mkRepo("r1", "acme/api"), mkRepo("r2", "acme/web")];
  defaultRepo = "r1";
  route();
});
afterEach(cleanup);

describe("Agent ContextTab", () => {
  it("defaults to the workspace default repo", async () => {
    defaultRepo = "r2";
    renderTab();
    await waitFor(() => expect(screen.getByLabelText("Repository")).toHaveValue("r2"));
    await waitFor(() => expect(get).toHaveBeenCalledWith("/repos/r2/context/docs"));
  });

  it("remembers the repo selection in localStorage", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByLabelText("Repository")).toHaveValue("r1"));
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "r2" } });
    expect(window.localStorage.getItem(REPO_STORAGE_KEY)).toBe("r2");
    await waitFor(() => expect(get).toHaveBeenCalledWith("/repos/r2/context/docs"));
  });

  it("prefers a remembered repo over the default", async () => {
    window.localStorage.setItem(REPO_STORAGE_KEY, "r2");
    renderTab();
    await waitFor(() => expect(screen.getByLabelText("Repository")).toHaveValue("r2"));
  });

  it("survives localStorage failures", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    renderTab();
    await waitFor(() => expect(screen.getByLabelText("Repository")).toHaveValue("r1"));
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "r2" } });
    expect(screen.getByLabelText("Repository")).toHaveValue("r2");
    vi.restoreAllMocks();
  });

  it("no repos: shows the hint with Re-index disabled", async () => {
    repos = [];
    defaultRepo = null;
    renderTab();
    expect(await screen.findByText(contextMessages.noRepo)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Re-index/ })).toBeDisabled();
  });
});
