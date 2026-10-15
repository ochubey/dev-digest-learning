import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiAgentView, CiInstallation, CiRun, Repo } from "@devdigest/shared";
import ciExport from "../../../../../../../../messages/en/ciExport.json";
import ciRuns from "../../../../../../../../messages/en/ciRuns.json";
import agents from "../../../../../../../../messages/en/agents.json";
import evalsDashboard from "../../../../../../../../messages/en/evalsDashboard.json";
import common from "../../../../../../../../messages/en/common.json";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      put: (...a: unknown[]) => put(...a),
    },
  };
});

import { CiTab } from "./CiTab";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openrouter",
  model: "anthropic/claude-sonnet",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  skill_count: 0,
};

function mkInst(over: Partial<CiInstallation> = {}): CiInstallation {
  return {
    id: "i1",
    agent_id: "ag1",
    repo: "acme/api",
    target_type: "gha",
    installed_at: "2026-10-11T10:00:00Z",
    workflow_version: 1,
    triggers: ["opened", "reopened"],
    post_as: "pr_comment",
    pr_url: "https://github.com/acme/api/pull/9",
    config_changed: false,
    last_run: null,
    ...over,
  };
}

function mkRun(id: string): CiRun {
  return {
    id,
    ci_installation_id: "i1",
    pr_number: 3,
    ran_at: "2026-10-11T11:00:00Z",
    status: "succeeded",
    findings_count: 0,
    cost_usd: 0.01,
    github_url: "https://github.com/acme/api/actions/runs/1",
    source: "gha",
    agent: "Security Reviewer",
    repo: "acme/api",
    pr_title: `PR ${id}`,
  };
}

const repo = (id: string, full_name: string): Repo => ({
  id,
  workspace_id: "w",
  owner: "acme",
  name: full_name.split("/")[1]!,
  full_name,
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
});

let view: CiAgentView | Error;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ciExport, ciRuns, agents, evalsDashboard, common }}>
        <CiTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  view = { installations: [], runs: [] };
  get.mockImplementation((url: string) => {
    if (url === "/agents/ag1/ci") return view instanceof Error ? Promise.reject(view) : Promise.resolve(view);
    if (url === "/repos") return Promise.resolve([repo("1", "acme/api"), repo("2", "acme/web")]);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  post.mockResolvedValue({ synced_at: "2026-10-11T12:00:00Z", seen: 0, ingested: 0, rejected: 0, failures: [] });
  put.mockImplementation((_u: string, patch: object) => Promise.resolve({ ...AGENT, ...patch }));
});

describe("CiTab", () => {
  it("AC-2 Add to CI opens labelled dialog, four step labels, Target active", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add to CI" }));
    const d = await screen.findByRole("dialog", { name: "Export to CI" });
    for (const l of ["Target", "Preview", "Configure", "Install"]) {
      expect(within(d).getAllByText(l).length).toBeGreaterThan(0);
    }
    expect(within(d).getByRole("status")).toHaveTextContent("Step 1 of 4: Target");
  });

  it('AC-81 "Not in CI yet"', async () => {
    mount();
    expect(await screen.findByText("Not in CI yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to CI" })).toBeInTheDocument();
  });

  it("AC-82 two installations: repo, GitHub Actions, workflow version, install time, PR link / \"Files downloaded\", last run or \"No runs yet\"", async () => {
    view = {
      installations: [
        mkInst({ id: "i1", repo: "acme/api", last_run: { status: "failed", ran_at: "2026-10-11T11:00:00Z" } }),
        mkInst({ id: "i2", repo: "acme/web", pr_url: null, workflow_version: 2, last_run: null }),
      ],
      runs: [],
    };
    mount();
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    const [a, b] = items as [HTMLElement, HTMLElement];
    expect(a).toHaveTextContent("acme/api");
    expect(a).toHaveTextContent("GitHub Actions");
    expect(a).toHaveTextContent("Workflow v1");
    expect(a).toHaveTextContent(/Installed .*2026/);
    expect(within(a).getByRole("link", { name: "Pull request" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/pull/9",
    );
    expect(a).toHaveTextContent(/Last run: Failed at .*2026/);
    expect(b).toHaveTextContent("acme/web");
    expect(b).toHaveTextContent("Workflow v2");
    expect(b).toHaveTextContent("Files downloaded");
    expect(within(b).queryByRole("link")).not.toBeInTheDocument();
    expect(b).toHaveTextContent("No runs yet");
  });

  it("AC-83 changing Fail CI on sends PUT /agents/:id {ci_fail_on}", async () => {
    mount();
    await screen.findByText("Not in CI yet");
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("critical");
    fireEvent.change(select, { target: { value: "any" } });
    await waitFor(() => expect(put).toHaveBeenCalledWith("/agents/ag1", { ci_fail_on: "any" }));
  });

  it("AC-84 text", async () => {
    mount();
    await screen.findByText("Not in CI yet");
    expect(
      screen.getByText(
        "Fail CI on makes the check exit non-zero. Blocking merges also needs the check to be required in the repository settings.",
      ),
    ).toBeInTheDocument();
  });

  it('AC-85 "Config changed since export" + Update CI config', async () => {
    view = {
      installations: [mkInst({ id: "i1", config_changed: true }), mkInst({ id: "i2", repo: "acme/web", config_changed: false })],
      runs: [],
    };
    mount();
    await screen.findByText("Config changed since export");
    expect(screen.getAllByText("Config changed since export")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Update CI config" })).toHaveLength(1);
  });

  it("AC-86 wizard opens with repo, triggers, post mode preselected", async () => {
    view = { installations: [mkInst({ config_changed: true })], runs: [] };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Update CI config" }));
    const d = await screen.findByRole("dialog", { name: "Export to CI" });
    expect(await within(d).findByRole("radio", { name: "acme/api" })).toBeChecked();
    expect(within(d).getByRole("radio", { name: "acme/web" })).not.toBeChecked();
    // preview request carries the installation's triggers and post mode
    post.mockImplementation((url: string, body: unknown) =>
      url.endsWith("/preview")
        ? Promise.resolve({ files: [], slug: "s", workflow_version: 1, runner_version: "2" })
        : Promise.resolve({ synced_at: "x", seen: 0, ingested: 0, rejected: 0, failures: [] }),
    );
    fireEvent.click(within(d).getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        "/agents/ag1/export-ci/preview",
        expect.objectContaining({ repo: "acme/api", triggers: ["opened", "reopened"], post_as: "pr_comment" }),
      ),
    );
  });

  it("AC-87 20 runs, no agent column, one sync on mount", async () => {
    view = {
      installations: [mkInst()],
      runs: Array.from({ length: 20 }, (_, i) => mkRun(`r${i}`)),
    };
    mount();
    await screen.findByText("PR r0");
    expect(screen.getAllByRole("row")).toHaveLength(21);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).not.toContain("Agent");
    await waitFor(() => expect(post).toHaveBeenCalledWith("/ci/sync"));
    expect(post.mock.calls.filter((c) => c[0] === "/ci/sync")).toHaveLength(1);
  });

  it("AC-88 Add repository opens wizard with no repo", async () => {
    view = { installations: [mkInst()], runs: [] };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add repository" }));
    const d = await screen.findByRole("dialog", { name: "Export to CI" });
    expect(await within(d).findByRole("radio", { name: "acme/api" })).not.toBeChecked();
    expect(within(d).getByRole("radio", { name: "acme/web" })).not.toBeChecked();
    expect(within(d).getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("loading and error states", async () => {
    view = new Error("down");
    mount();
    expect(await screen.findByText("Could not load the CI deployment")).toBeInTheDocument();
  });
});
