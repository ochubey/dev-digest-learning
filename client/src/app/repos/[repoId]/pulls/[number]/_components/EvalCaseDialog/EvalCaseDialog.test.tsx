import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseDraft } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  };
});

import { EvalCaseDialog } from "./EvalCaseDialog";

const AGENTS = [
  { id: "a1", name: "Security reviewer" },
  { id: "a2", name: "Style reviewer" },
];

const DRAFT: EvalCaseDraft = {
  finding_id: "f1",
  pr_id: "p1",
  agent_id: "a1",
  name: "hardcoded-stripe-key",
  expectation: { kind: "must_find", file: "src/config.ts", start_line: 11, end_line: 12 },
  input_diff: "diff --git a/src/config.ts b/src/config.ts\n@@ -10,2 +10,3 @@\n+const k = 'sk_live';\n",
  origin: "accepted_finding",
  existing_cases: [],
};

function mockApi(draft: EvalCaseDraft | Error) {
  get.mockImplementation((path: string) => {
    if (path.startsWith("/findings/")) return draft instanceof Error ? Promise.reject(draft) : Promise.resolve(draft);
    if (path === "/agents") return Promise.resolve(AGENTS);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

function renderDialog(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <QueryClientProvider client={qc}>
        <EvalCaseDialog findingId="f1" onClose={onClose} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { ...utils, onClose };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});
afterEach(cleanup);

describe("EvalCaseDialog", () => {
  it("opens with the draft and sends no create request", async () => {
    mockApi(DRAFT);
    renderDialog();
    const dialog = await screen.findByRole("dialog", { name: "Turn into eval case" });
    expect(await within(dialog).findByDisplayValue("hardcoded-stripe-key")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/findings/f1/eval-case-draft");
    expect(post).not.toHaveBeenCalled();
  });

  it("fields: editable name, switchable kind, read-only file/range, monospaced fragment, owner agent, notes", async () => {
    mockApi(DRAFT);
    renderDialog();
    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "renamed" } });
    expect(name).toHaveValue("renamed");

    const mustFind = screen.getByRole("radio", { name: "Must find" });
    const mustNot = screen.getByRole("radio", { name: "Must not flag" });
    expect(mustFind).toBeChecked();
    fireEvent.click(mustNot);
    expect(mustNot).toBeChecked();

    expect(screen.getByText("src/config.ts")).toBeInTheDocument();
    expect(screen.getByText("11–12")).toBeInTheDocument();
    const pre = screen.getByText(/sk_live/);
    expect(pre.tagName).toBe("PRE");
    expect(pre.className).toContain("mono");

    expect(await screen.findByText("Security reviewer")).toBeInTheDocument();
    const notes = screen.getByLabelText("Notes (optional)");
    fireEvent.change(notes, { target: { value: "why" } });
    expect(notes).toHaveValue("why");
  });

  it("shows the dismissed hint only while Must not flag is chosen", async () => {
    mockApi({ ...DRAFT, origin: "dismissed_finding", expectation: { ...DRAFT.expectation, kind: "must_not_flag" } });
    renderDialog();
    const hint = "Dismissed is not always 'no problem'. Save as Must not flag only if the agent should stay silent here.";
    expect(await screen.findByText(hint)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Must find" }));
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
  });

  it("save sends the reviewed payload, then confirms with a link to the Evals tab", async () => {
    mockApi(DRAFT);
    post.mockResolvedValue({ id: "c1" });
    renderDialog();
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "  my case " } });
    fireEvent.click(screen.getByRole("radio", { name: "Must not flag" }));
    fireEvent.change(screen.getByLabelText("Notes (optional)"), { target: { value: "n1" } });
    await screen.findByText("Security reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Save eval case" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/eval-cases", {
      agent_id: "a1",
      finding_id: "f1",
      name: "my case",
      expectation: { kind: "must_not_flag", file: "src/config.ts", start_line: 11, end_line: 12 },
      input_diff: DRAFT.input_diff,
      notes: "n1",
    });
    expect(await screen.findByText("Eval case saved")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the Evals tab" })).toHaveAttribute("href", "/agents/a1?tab=evals");
  });

  it("agent_id null: Save stays disabled until an agent is picked", async () => {
    mockApi({ ...DRAFT, agent_id: null });
    post.mockResolvedValue({ id: "c1" });
    renderDialog();
    const save = await screen.findByRole("button", { name: "Save eval case" });
    expect(save).toBeDisabled();
    const picker = await screen.findByLabelText("Owner agent");
    await screen.findByRole("option", { name: "Style reviewer" });
    fireEvent.change(picker, { target: { value: "a2" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]![1]).toMatchObject({ agent_id: "a2" });
  });

  it("existing case for the chosen agent: link instead of Save", async () => {
    mockApi({ ...DRAFT, agent_id: null, existing_cases: [{ agent_id: "a2", case_id: "c9" }] });
    renderDialog();
    const picker = await screen.findByLabelText("Owner agent");
    await screen.findByRole("option", { name: "Style reviewer" });
    expect(screen.getByRole("button", { name: "Save eval case" })).toBeDisabled();
    fireEvent.change(picker, { target: { value: "a2" } });
    expect(screen.getByText("Already an eval case")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the Evals tab" })).toHaveAttribute("href", "/agents/a2?tab=evals");
    expect(screen.queryByRole("button", { name: "Save eval case" })).not.toBeInTheDocument();
  });

  it("existing case for the owner agent shows the state straight away", async () => {
    mockApi({ ...DRAFT, existing_cases: [{ agent_id: "a1", case_id: "c9" }] });
    renderDialog();
    expect(await screen.findByText("Already an eval case")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save eval case" })).not.toBeInTheDocument();
  });

  it("failing save keeps the dialog open with the edits and shows an error", async () => {
    mockApi(DRAFT);
    post.mockRejectedValue(new Error("boom"));
    const { onClose } = renderDialog();
    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "kept edit" } });
    await screen.findByText("Security reviewer");
    fireEvent.click(screen.getByRole("button", { name: "Save eval case" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the eval case. Your edits are kept.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("kept edit");
    expect(screen.getByRole("button", { name: "Save eval case" })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a refused draft shows the server message and no form", async () => {
    const { ApiError } = await import("@/lib/api");
    mockApi(new ApiError("The finding's lines are no longer in the PR diff", 400, "bad_request"));
    renderDialog();
    expect(await screen.findByRole("alert")).toHaveTextContent("The finding's lines are no longer in the PR diff");
    expect(screen.queryByRole("button", { name: "Save eval case" })).not.toBeInTheDocument();
  });

  it("renders hostile name and fragment as plain text", async () => {
    mockApi({
      ...DRAFT,
      name: '<img src=x onerror="alert(1)">',
      input_diff: '+<img src=x onerror="alert(2)">\n',
      expectation: { ...DRAFT.expectation, file: "<img src=x onerror=alert(3)>.ts" },
    });
    const { baseElement } = renderDialog();
    await screen.findByLabelText("Name");
    expect(baseElement.querySelector("img")).toBeNull();
    expect(screen.getByLabelText("Name")).toHaveValue('<img src=x onerror="alert(1)">');
    expect(screen.getByText(/alert\(2\)/).tagName).toBe("PRE");
  });

  it("Escape closes and focus returns to the opener; the dialog is labelled", async () => {
    mockApi(DRAFT);
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { unmount } = renderDialog(onClose);
    const dialog = await screen.findByRole("dialog", { name: "Turn into eval case" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
