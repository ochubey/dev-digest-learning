import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { CiRun, CiRunsList, CiSyncResult } from "@devdigest/shared";
import ciRuns from "../../../../../messages/en/ciRuns.json";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  };
});

import { CiRunsView } from "./CiRunsView";

afterEach(cleanup);

function mkRun(id: string, title: string, ranAt: string): CiRun {
  return {
    id,
    ci_installation_id: "i1",
    pr_number: 1,
    ran_at: ranAt,
    status: "succeeded",
    findings_count: 0,
    cost_usd: 0.01,
    github_url: "https://github.com/acme/api/actions/runs/1",
    source: "gha",
    agent: "Sec",
    repo: "acme/api",
    pr_title: title,
  };
}
const list = (runs: CiRun[], installations_count = 1): CiRunsList => ({ runs, installations_count });
const syncOk = (over: Partial<CiSyncResult> = {}): CiSyncResult => ({
  synced_at: "2026-10-11T12:00:00Z",
  seen: 1,
  ingested: 1,
  rejected: 0,
  failures: [],
  ...over,
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ciRuns }}>
        <CiRunsView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("CiRunsView", () => {
  it("AC-71 stored runs shown immediately, sync started, list refreshed after", async () => {
    let resolveSync!: (v: CiSyncResult) => void;
    post.mockReturnValue(new Promise<CiSyncResult>((r) => (resolveSync = r)));
    get.mockResolvedValueOnce(list([mkRun("r1", "Stored PR", "2026-10-10T10:00:00Z")]));
    mount();

    expect(await screen.findByText("Stored PR")).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/ci/sync");

    get.mockResolvedValue(
      list([mkRun("r2", "Fresh PR", "2026-10-11T10:00:00Z"), mkRun("r1", "Stored PR", "2026-10-10T10:00:00Z")]),
    );
    resolveSync(syncOk());
    expect(await screen.findByText("Fresh PR")).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("AC-72 order newest first", async () => {
    post.mockResolvedValue(syncOk());
    get.mockResolvedValue(
      list([mkRun("r2", "Newer", "2026-10-11T10:00:00Z"), mkRun("r1", "Older", "2026-10-10T10:00:00Z")]),
    );
    mount();
    await screen.findByText("Newer");
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByText("Newer")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Older")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toContain("Agent");
  });

  it('AC-75 Refresh busy state + "Last synced"', async () => {
    post.mockResolvedValueOnce(syncOk());
    get.mockResolvedValue(list([mkRun("r1", "PR", "2026-10-10T10:00:00Z")]));
    mount();
    expect(await screen.findByText(/^Last synced /)).toBeInTheDocument();

    let resolveSecond!: (v: CiSyncResult) => void;
    post.mockReturnValueOnce(new Promise<CiSyncResult>((r) => (resolveSecond = r)));
    const btn = screen.getByRole("button", { name: /Refresh/ });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("button", { name: /Refresh/ })).toBeDisabled());
    expect(post).toHaveBeenCalledTimes(2);
    resolveSecond(syncOk());
    await waitFor(() => expect(screen.getByRole("button", { name: /Refresh/ })).toBeEnabled());
  });

  it("AC-76 partial failure warning lists repos + messages; runs still shown", async () => {
    post.mockResolvedValue(
      syncOk({
        failures: [
          { repo: "acme/api", code: "github_actions_read_denied", message: "No Actions read access" },
          { repo: "acme/web", code: "github_error", message: "GitHub is down" },
        ],
      }),
    );
    get.mockResolvedValue(list([mkRun("r1", "Still shown", "2026-10-10T10:00:00Z")]));
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Some repositories could not be synced");
    expect(alert).toHaveTextContent("acme/api: No Actions read access");
    expect(alert).toHaveTextContent("acme/web: GitHub is down");
    expect(screen.getByText("Still shown")).toBeInTheDocument();
  });

  it("AC-77 loading and error + Try again", async () => {
    post.mockResolvedValue(syncOk());
    get.mockReturnValueOnce(new Promise(() => {}));
    const first = mount();
    expect(screen.getByRole("status", { name: "Loading CI runs" })).toBeInTheDocument();
    first.unmount();

    get.mockReset();
    get.mockRejectedValue(new Error("boom"));
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load CI runs");
    get.mockResolvedValue(list([mkRun("r1", "Recovered", "2026-10-10T10:00:00Z")]));
    fireEvent.click(within(alert).getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("Recovered")).toBeInTheDocument();
  });

  it("AC-78 empty without installations + link /agents", async () => {
    post.mockResolvedValue(syncOk());
    get.mockResolvedValue(list([], 0));
    mount();
    expect(
      await screen.findByText("No CI runs yet. Once you export an agent to CI, every automated review shows up here."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up CI for an agent" })).toHaveAttribute("href", "/agents");
  });

  it("AC-79 empty with installations", async () => {
    post.mockResolvedValue(syncOk());
    get.mockResolvedValue(list([], 2));
    mount();
    expect(
      await screen.findByText(
        "No CI runs yet. Runs appear after the DevDigest PR is merged and a pull request triggers the workflow.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set up CI for an agent" })).not.toBeInTheDocument();
  });
});
