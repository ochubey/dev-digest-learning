import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiExport, CiPreview, Repo } from "@devdigest/shared";
import ciExport from "../../../../messages/en/ciExport.json";
import ciRuns from "../../../../messages/en/ciRuns.json";
import agents from "../../../../messages/en/agents.json";
import evalsDashboard from "../../../../messages/en/evalsDashboard.json";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  };
});

import { ApiError } from "@/lib/api";
import { ExportCiWizard } from "./ExportCiWizard";

const WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openrouter",
  model: "anthropic/claude-sonnet",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "warning",
  repo_intel: true,
  enabled: true,
  version: 1,
  skill_count: 0,
};

const repo = (id: string, full_name: string): Repo => ({
  id,
  workspace_id: "w1",
  owner: full_name.split("/")[0]!,
  name: full_name.split("/")[1]!,
  full_name,
  default_branch: "main",
  clone_path: null,
  last_polled_at: null,
  created_by: null,
});
const REPOS = [repo("1", "acme/api"), repo("2", "acme/web")];

function mkPreview(workflow = "name: v1\n"): CiPreview {
  return {
    slug: "security-reviewer",
    workflow_version: 1,
    runner_version: "2",
    files: [
      { path: WORKFLOW_PATH, contents: workflow, editable: true },
      { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: Security Reviewer\n", editable: false },
      { path: ".devdigest/runner/index.js", contents: "", editable: false, size_bytes: 2048 },
    ],
  };
}

function mkExport(over: Partial<CiExport> = {}): CiExport {
  return {
    installation: {
      id: "i1",
      agent_id: "ag1",
      repo: "acme/api",
      target_type: "gha",
      installed_at: "2026-10-11T10:00:00Z",
    },
    files: [],
    pr_url: "https://github.com/acme/api/pull/9",
    ...over,
  };
}

let repos: Repo[];
let previewImpl: (body: unknown) => Promise<CiPreview>;
let exportImpl: (body: unknown) => Promise<CiExport>;

const calls = (suffix: string) => post.mock.calls.filter((c) => String(c[0]).endsWith(suffix));

function Harness({ agent = AGENT, initial }: { agent?: Agent; initial?: React.ComponentProps<typeof ExportCiWizard>["initial"] }) {
  const [open, setOpen] = React.useState(true);
  const ref = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} onClick={() => setOpen(true)}>
        opener
      </button>
      {open && <ExportCiWizard agent={agent} initial={initial} returnFocusRef={ref} onClose={() => setOpen(false)} />}
    </>
  );
}

function mount(props: React.ComponentProps<typeof Harness> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ciExport, ciRuns, agents, evalsDashboard }}>
        <Harness {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const dialog = () => screen.getByRole("dialog", { name: "Export to CI" });
const stepText = () => within(dialog()).getByRole("status").textContent;
const click = (name: string | RegExp) => fireEvent.click(within(dialog()).getByRole("button", { name }));

async function pickRepo(name = "acme/api") {
  fireEvent.click(await screen.findByRole("radio", { name }));
}

async function toPreview(name = "acme/api") {
  await pickRepo(name);
  click("Continue");
  await screen.findByRole("textbox", { name: `Edit ${WORKFLOW_PATH}` });
}

async function toConfigure(name = "acme/api") {
  await toPreview(name);
  click("Continue");
  await screen.findByText("Post results as");
}

async function toInstall() {
  await toConfigure();
  click("Continue");
  await screen.findByRole("button", { name: /Open a PR with these files/ });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  repos = REPOS;
  previewImpl = () => Promise.resolve(mkPreview());
  exportImpl = () => Promise.resolve(mkExport());
  get.mockImplementation((url: string) =>
    url === "/repos" ? Promise.resolve(repos) : Promise.reject(new Error(`unexpected ${url}`)),
  );
  post.mockImplementation((url: string, body: unknown) =>
    url.endsWith("/export-ci/preview") ? previewImpl(body) : exportImpl(body),
  );
});
afterEach(cleanup);

describe("ExportCiWizard shell", () => {
  it('AC-2 labelled dialog, four step labels, "Step 1 of 4: Target"', async () => {
    mount();
    const d = dialog();
    expect(d).toHaveAttribute("data-testid", "export-ci-wizard");
    for (const l of ["Target", "Preview", "Configure", "Install"]) {
      expect(within(d).getAllByText(l).length).toBeGreaterThan(0);
    }
    expect(stepText()).toBe("Step 1 of 4: Target");
    await pickRepo();
    click("Continue");
    await screen.findByRole("textbox");
    expect(stepText()).toBe("Step 2 of 4: Preview");
  });

  it("AC-9 Escape and Close send no export request and return focus to the opener", async () => {
    mount();
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    // re-open so the dialog captures the opener as the focused element
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(opener);
    await screen.findByRole("dialog");
    click("Close");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
    expect(calls("/export-ci")).toHaveLength(0);
  });

  it("AC-10 edit workflow, go to Configure, Back -> edit kept", async () => {
    mount();
    await toPreview();
    const box = screen.getByRole("textbox", { name: `Edit ${WORKFLOW_PATH}` });
    fireEvent.change(box, { target: { value: "name: my edit\n" } });
    click("Continue");
    await screen.findByText("Post results as");
    expect(stepText()).toBe("Step 3 of 4: Configure");
    click("Back");
    const again = await screen.findByRole("textbox", { name: `Edit ${WORKFLOW_PATH}` });
    expect(again).toHaveValue("name: my edit\n");
    expect(calls("/export-ci/preview")).toHaveLength(1);
  });

  it("Tab wraps focus inside the dialog", async () => {
    mount();
    await screen.findByRole("radio", { name: "acme/api" });
    const d = dialog();
    const focusable = Array.from(
      d.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])'),
    );
    const last = focusable[focusable.length - 1]!;
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
  });
});

describe("ExportCiWizard Target", () => {
  it('AC-3 only "GitHub Actions", preselected; no CircleCI/Jenkins/Generic CLI', async () => {
    mount();
    const gha = within(dialog()).getByRole("button", { name: /GitHub Actions/ });
    expect(gha).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/CircleCI/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Jenkins/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Generic CLI/)).not.toBeInTheDocument();
    await screen.findByRole("radio", { name: "acme/api" });
  });

  it("AC-4 two repos selectable", async () => {
    mount();
    const a = await screen.findByRole("radio", { name: "acme/api" });
    const b = screen.getByRole("radio", { name: "acme/web" });
    fireEvent.click(b);
    expect(b).toBeChecked();
    expect(a).not.toBeChecked();
    fireEvent.click(a);
    expect(a).toBeChecked();
  });

  it("AC-5 Continue disabled then enabled", async () => {
    mount();
    await screen.findByRole("radio", { name: "acme/api" });
    expect(within(dialog()).getByRole("button", { name: "Continue" })).toBeDisabled();
    await pickRepo();
    expect(within(dialog()).getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it('AC-6 empty repo list -> "Connect a repository first" linking /onboarding', async () => {
    repos = [];
    mount();
    expect(await screen.findByText(/Connect a repository first/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to repository setup" })).toHaveAttribute("href", "/onboarding");
    expect(within(dialog()).getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("AC-7 openai agent -> message, Continue disabled, no request", async () => {
    mount({ agent: { ...AGENT, provider: "openai" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("CI export supports OpenRouter agents only");
    await pickRepo();
    expect(within(dialog()).getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Continue" }));
    expect(post).not.toHaveBeenCalled();
  });

  it("AC-8 ci_repo_taken message rendered on Target", async () => {
    previewImpl = () =>
      Promise.reject(new ApiError("acme/api is already used by another agent", 409, "ci_repo_taken"));
    mount();
    await pickRepo();
    click("Continue");
    expect(await screen.findByText("acme/api is already used by another agent")).toBeInTheDocument();
    expect(stepText()).toBe("Step 1 of 4: Target");
  });
});

describe("ExportCiWizard Preview", () => {
  it("AC-11 file list renders", async () => {
    mount();
    await toPreview();
    const list = screen.getByRole("listbox", { name: "Files to create" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      WORKFLOW_PATH,
      ".devdigest/agents/security-reviewer.yaml",
      ".devdigest/runner/index.js",
    ]);
    expect(post).toHaveBeenCalledWith("/agents/ag1/export-ci/preview", expect.objectContaining({ repo: "acme/api" }));
  });

  it("AC-12 manifest has no textbox; workflow has one; runner shows size + runner version", async () => {
    mount();
    await toPreview();
    expect(screen.getByRole("textbox", { name: `Edit ${WORKFLOW_PATH}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: ".devdigest/agents/security-reviewer.yaml" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("read-only")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: ".devdigest/runner/index.js" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Runner bundle, 2\.0 KB, runner version 2/)).toBeInTheDocument();
  });

  it("AC-29 ci_workflow_unsafe from export -> back on Preview with the rule message", async () => {
    exportImpl = () =>
      Promise.reject(new ApiError("The workflow widens permissions (permissions_widened)", 400, "ci_workflow_unsafe", { rule: "permissions_widened" }));
    mount();
    await toInstall();
    fireEvent.click(screen.getByRole("button", { name: /Open a PR with these files/ }));
    expect(await screen.findByText("The workflow widens permissions (permissions_widened)")).toBeInTheDocument();
    expect(stepText()).toBe("Step 2 of 4: Preview");
    expect(screen.getByRole("textbox", { name: `Edit ${WORKFLOW_PATH}` })).toBeInTheDocument();
  });

  it("AC-35 config changed + no edit -> regenerated workflow shown", async () => {
    let n = 0;
    previewImpl = () => Promise.resolve(mkPreview(n++ === 0 ? "name: first\n" : "name: regenerated\n"));
    mount();
    await toConfigure();
    fireEvent.click(screen.getByRole("checkbox", { name: "pull_request: reopened" }));
    click("Continue");
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: `Edit ${WORKFLOW_PATH}` })).toHaveValue("name: regenerated\n"),
    );
    expect(calls("/export-ci/preview")).toHaveLength(2);
    expect(calls("/export-ci/preview")[1]![1]).toMatchObject({ triggers: ["opened", "synchronize", "reopened"] });
    expect(stepText()).toBe("Step 2 of 4: Preview");
  });

  it('AC-35 edited -> "Discard your workflow edits and regenerate?" (confirm replaces, cancel keeps)', async () => {
    let n = 0;
    previewImpl = () => Promise.resolve(mkPreview(n++ === 0 ? "name: first\n" : "name: regenerated\n"));
    mount();
    await toPreview();
    fireEvent.change(screen.getByRole("textbox", { name: `Edit ${WORKFLOW_PATH}` }), {
      target: { value: "name: mine\n" },
    });
    click("Continue");
    await screen.findByText("Post results as");
    fireEvent.click(screen.getByRole("checkbox", { name: "pull_request: reopened" }));
    click("Continue");

    expect(await screen.findByText("Discard your workflow edits and regenerate?")).toBeInTheDocument();
    // cancel keeps the edit and does not regenerate
    fireEvent.click(screen.getByRole("button", { name: "Keep my edits" }));
    expect(screen.queryByText("Discard your workflow edits and regenerate?")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: `Edit ${WORKFLOW_PATH}` })).toHaveValue("name: mine\n");
    expect(calls("/export-ci/preview")).toHaveLength(1);

    // change again and confirm
    click("Continue");
    await screen.findByText("Post results as");
    fireEvent.click(screen.getByRole("checkbox", { name: "pull_request: reopened" }));
    click("Continue");
    fireEvent.click(await screen.findByRole("button", { name: "Discard and regenerate" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: `Edit ${WORKFLOW_PATH}` })).toHaveValue("name: regenerated\n"),
    );
    expect(calls("/export-ci/preview")).toHaveLength(2);
  });
});

describe("ExportCiWizard Configure", () => {
  it("AC-31 three triggers, opened+synchronize default", async () => {
    mount();
    await toConfigure();
    expect(screen.getByRole("checkbox", { name: "pull_request: opened" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "pull_request: synchronize" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "pull_request: reopened" })).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  });

  it("AC-32 none selected -> Continue disabled + \"Pick at least one event\"", async () => {
    mount();
    await toConfigure();
    fireEvent.click(screen.getByRole("checkbox", { name: "pull_request: opened" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "pull_request: synchronize" }));
    expect(screen.getByText("Pick at least one event")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("AC-33 GitHub review default", async () => {
    mount();
    await toConfigure();
    expect(screen.getByRole("radio", { name: "GitHub review" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "PR comment" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "None (exit code only)" })).not.toBeChecked();
  });

  it("AC-34 shows agent ci_fail_on + required-check text", async () => {
    mount();
    await toConfigure();
    expect(screen.getByText("Warning and above")).toBeInTheDocument();
    expect(
      screen.getByText(/make the `devdigest-review` check required in the repository's branch protection or ruleset/),
    ).toBeInTheDocument();
  });

  it("preselects the initial repo, triggers and post mode (Update CI config)", async () => {
    mount({ initial: { repo: "acme/web", triggers: ["reopened"], postAs: "pr_comment" } });
    expect(await screen.findByRole("radio", { name: "acme/web" })).toBeChecked();
    click("Continue");
    await screen.findByRole("textbox");
    expect(post.mock.calls[0]![1]).toMatchObject({ repo: "acme/web", triggers: ["reopened"], post_as: "pr_comment" });
    click("Continue");
    await screen.findByText("Post results as");
    expect(screen.getByRole("checkbox", { name: "pull_request: reopened" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "pull_request: opened" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "PR comment" })).toBeChecked();
  });
});

describe("ExportCiWizard Install", () => {
  it("AC-36 both options + branch text", async () => {
    mount();
    await toInstall();
    expect(screen.getByRole("button", { name: /Open a PR with these files/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Download files as zip/ })).toBeEnabled();
    expect(screen.getByText(/devdigest\/ci/)).toBeInTheDocument();
    expect(screen.getByText(/is overwritten if it exists/)).toBeInTheDocument();
    expect(stepText()).toBe("Step 4 of 4: Install");
  });

  it("AC-41 success: PR link, secrets settings link, Done", async () => {
    mount();
    await toInstall();
    fireEvent.click(screen.getByRole("button", { name: /Open a PR with these files/ }));
    const pr = await screen.findByRole("link", { name: "View the pull request" });
    expect(pr).toHaveAttribute("href", "https://github.com/acme/api/pull/9");
    expect(pr).toHaveAttribute("rel", "noopener noreferrer");
    const secrets = screen.getByRole("link", { name: "Open the Actions secrets settings" });
    expect(secrets).toHaveAttribute("href", "https://github.com/acme/api/settings/secrets/actions");
    expect(screen.getByText(/OPENROUTER_API_KEY/, { selector: "strong" })).toBeInTheDocument();
    expect(calls("/export-ci")[0]![1]).toMatchObject({ repo: "acme/api", action: "open_pr", target: "gha" });
    click("Done");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("success with a non-GitHub pr_url renders no PR link", async () => {
    exportImpl = () => Promise.resolve(mkExport({ pr_url: "https://evil.example/pr/1" }));
    mount();
    await toInstall();
    fireEvent.click(screen.getByRole("button", { name: /Open a PR with these files/ }));
    await screen.findByRole("link", { name: "Open the Actions secrets settings" });
    expect(screen.queryByRole("link", { name: "View the pull request" })).not.toBeInTheDocument();
  });

  it("AC-43 github_workflow_scope_missing: stays on Install, message, zip enabled", async () => {
    exportImpl = (body) =>
      (body as { action: string }).action === "open_pr"
        ? Promise.reject(new ApiError("Your GitHub token lacks the workflow scope", 403, "github_workflow_scope_missing"))
        : Promise.resolve(mkExport());
    mount();
    await toInstall();
    fireEvent.click(screen.getByRole("button", { name: /Open a PR with these files/ }));
    expect(await screen.findByText("Your GitHub token lacks the workflow scope")).toBeInTheDocument();
    expect(stepText()).toBe("Step 4 of 4: Install");
    expect(screen.getByRole("button", { name: /Download files as zip/ })).toBeEnabled();
  });

  it("AC-45 other error: message + Try again re-sends", async () => {
    let n = 0;
    exportImpl = () => (n++ === 0 ? Promise.reject(new ApiError("GitHub exploded", 502, "github_error")) : Promise.resolve(mkExport()));
    mount();
    await toInstall();
    fireEvent.click(screen.getByRole("button", { name: /Open a PR with these files/ }));
    expect(await screen.findByText("GitHub exploded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("link", { name: "View the pull request" });
    expect(calls("/export-ci")).toHaveLength(2);
    expect(calls("/export-ci")[1]![1]).toMatchObject({ action: "open_pr" });
  });

  it("AC-46 zip success triggers a download named devdigest-ci-<name>.zip", async () => {
    exportImpl = () =>
      Promise.resolve(mkExport({ pr_url: null, zip_base64: btoa("zipbytes"), zip_filename: "devdigest-ci-api.zip" }));
    const createObjectURL = vi.fn(() => "blob:x");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const downloads: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    mount();
    await toInstall();
    fireEvent.click(screen.getByRole("button", { name: /Download files as zip/ }));
    await screen.findByText(/The zip was downloaded/);
    expect(calls("/export-ci")[0]![1]).toMatchObject({ action: "files" });
    expect(downloads).toEqual(["devdigest-ci-api.zip"]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: "View the pull request" })).not.toBeInTheDocument();
    clickSpy.mockRestore();
  });

  it("AC-50 pending: both options disabled + progress", async () => {
    let resolve!: (v: CiExport) => void;
    exportImpl = () => new Promise<CiExport>((r) => (resolve = r));
    mount();
    await toInstall();
    fireEvent.click(screen.getByRole("button", { name: /Open a PR with these files/ }));
    await screen.findByText("Working…");
    expect(screen.getByRole("button", { name: /Open a PR with these files/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Download files as zip/ })).toBeDisabled();
    await act(async () => {
      resolve(mkExport());
    });
    await screen.findByRole("link", { name: "View the pull request" });
  });
});
