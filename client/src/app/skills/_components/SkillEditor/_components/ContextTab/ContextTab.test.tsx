import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDoc, Repo, Skill } from "@devdigest/shared";
import skillsMessages from "../../../../../../../messages/en/skills.json";
import agentsMessages from "../../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../../messages/en/projectContext.json";

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

const SKILL = { id: "sk1", name: "no-any" } as Skill;
const mkDoc = (path: string, tokens = 100): ContextDoc => {
  const parts = path.split("/");
  return {
    path,
    name: parts[parts.length - 1]!,
    folder: parts.slice(0, -1).join("/"),
    source: parts[0] as ContextDoc["source"],
    tokens,
  };
};

let docs: ContextDoc[];
let paths: string[];
let repos: Repo[];

function route() {
  get.mockImplementation(async (url: string) => {
    if (url === "/repos") return repos;
    if (url === "/context/default-repo") return { repo_id: repos[0]?.id ?? null };
    if (url === "/repos/r1/context/docs") return { repo_id: "r1", branch: "main", commit_sha: "a", docs };
    if (url === "/skills/sk1/context") return { paths, version: 1 };
    throw new Error(`unexpected GET ${url}`);
  });
  put.mockImplementation(async (_u: string, body: { paths: string[] }) => {
    paths = body.paths;
    return { paths, version: 2 };
  });
}

function renderTab(skill: Skill | null = SKILL) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ skills: skillsMessages, agents: agentsMessages, projectContext: contextMessages }}
    >
      <QueryClientProvider client={qc}>
        <ContextTab skill={skill} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  window.localStorage.clear();
  repos = [{ id: "r1", full_name: "acme/api" } as Repo];
  docs = [mkDoc("specs/a.md"), mkDoc("docs/b.md"), mkDoc("insights/c.md")];
  paths = [];
  route();
});
afterEach(cleanup);

describe("Skill ContextTab", () => {
  it("renders the title and attaches a document", async () => {
    renderTab();
    expect(screen.getByText("Project context to use")).toBeInTheDocument();
    const box = await screen.findByRole("checkbox", { name: /Attach specs\/a\.md/ });
    fireEvent.click(box);
    await waitFor(() => expect(put).toHaveBeenCalledWith("/skills/sk1/context", { paths: ["specs/a.md"] }));
    expect(await screen.findByText("1 attached")).toBeInTheDocument();
  });

  it("is always expanded: no collapse control", async () => {
    renderTab();
    await screen.findByRole("checkbox", { name: /Attach specs\/a\.md/ });
    expect(screen.queryByRole("button", { name: /collapse|expand/i })).not.toBeInTheDocument();
    expect(document.querySelector("[aria-expanded]")).toBeNull();
  });

  it("shows the inheritance hint", () => {
    renderTab();
    expect(screen.getByText("Any agent using this skill inherits these documents.")).toBeInTheDocument();
  });

  it("shows the Serializes as block with the exact text", async () => {
    paths = ["docs/b.md", "specs/a.md"];
    renderTab();
    const block = await screen.findByTestId("context-serializes-as");
    expect(block).toHaveTextContent("Serializes as");
    const pre = block.querySelector("pre")!;
    expect(pre.textContent).toBe(
      "## Project specifications\n- specs/a.md\n\n## Project docs\n- docs/b.md",
    );
  });

  it("ignores attached docs missing on main in Serializes as; hides it when none found", async () => {
    paths = ["specs/gone.md"];
    renderTab();
    await screen.findByRole("checkbox", { name: /Attach specs\/a\.md/ });
    expect(screen.queryByTestId("context-serializes-as")).not.toBeInTheDocument();
  });

  it("docs discovered but none attached: message above a still-visible list", async () => {
    renderTab();
    const msg = await screen.findByText("No project context attached to this skill.");
    const row = await screen.findByRole("checkbox", { name: /Attach specs\/a\.md/ });
    expect(msg.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId("context-serializes-as")).not.toBeInTheDocument();
  });

  it("no docs discovered: picker empty state, no none-attached message", async () => {
    docs = [];
    renderTab();
    expect(await screen.findByText(contextMessages.empty.title)).toBeInTheDocument();
    expect(screen.queryByText("No project context attached to this skill.")).not.toBeInTheDocument();
  });

  it("skill=null: disabled with the unsaved hint, picker not mounted", () => {
    renderTab(null);
    expect(screen.getByText(skillsMessages.projectContext.disabledUnsaved)).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter documents")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
