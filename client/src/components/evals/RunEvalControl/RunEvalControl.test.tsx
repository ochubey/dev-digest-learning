import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalSuiteRun } from "@devdigest/shared";
import evalsShared from "../../../../messages/en/evalsShared.json";

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
import { RunEvalControl } from "./RunEvalControl";

function mkRun(status: EvalSuiteRun["status"], done = 0, total = 9): EvalSuiteRun {
  return {
    id: "r1",
    agent_id: "a1",
    agent_version: 1,
    status,
    error: null,
    cases_total: total,
    cases_done: done,
    metrics: { recall: null, precision: null, citation_accuracy: null },
    counts: null,
    duration_ms: null,
    cost_usd: null,
    started_at: "2026-10-11T10:00:00Z",
    finished_at: null,
  };
}
const page = (items: EvalSuiteRun[]) => ({ items, next_cursor: null });

const MODELS = [
  { id: "gpt-test", pricing: null, contextLength: null },
  { id: "gpt-other", pricing: null, contextLength: null },
];
let models: unknown = MODELS;
let modelsFail = false;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ evalsShared }}>
        <RunEvalControl agentId="a1" caseCount={9} model="gpt-test" provider="openai" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** Route the mocked GET: provider models vs the agent's eval runs. */
function setRuns(items: EvalSuiteRun[]) {
  get.mockImplementation(async (url: string) => {
    if (url.startsWith("/providers/")) {
      if (modelsFail) throw new Error("no key");
      return models;
    }
    return page(items);
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  models = MODELS;
  modelsFail = false;
  setRuns([]);
});
afterEach(cleanup);

describe("RunEvalControl", () => {
  it("confirm text, Cancel sends nothing, Run sends one POST", async () => {
    post.mockResolvedValue({ run_id: "r1" });
    mount();
    fireEvent.click(screen.getByTestId("eval-run-button"));
    expect(
      screen.getByText("Run 9 cases with gpt-test? Each case makes one review call to the model."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();

    fireEvent.click(screen.getByTestId("eval-run-button"));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[0]).toBe("/agents/a1/eval-runs");
  });

  it("default option sends no model; picking another sends {model} and updates the text", async () => {
    post.mockResolvedValue({ run_id: "r1" });
    mount();
    fireEvent.click(screen.getByTestId("eval-run-button"));
    const select = screen.getByLabelText("Model for this run") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: "Agent default (gpt-test)" })).toBeInTheDocument();
    expect(screen.getByText("This changes the model for this run only; the agent keeps its configuration.")).toBeInTheDocument();
    await screen.findByRole("option", { name: "gpt-other" });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]).toEqual(["/agents/a1/eval-runs"]);

    fireEvent.click(screen.getByTestId("eval-run-button"));
    fireEvent.change(screen.getByLabelText("Model for this run"), { target: { value: "gpt-other" } });
    expect(
      screen.getByText("Run 9 cases with gpt-other? Each case makes one review call to the model."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1]).toEqual(["/agents/a1/eval-runs", { model: "gpt-other" }]);
  });

  it("models list failure keeps only the agent model and shows a hint", async () => {
    modelsFail = true;
    models = [];
    mount();
    fireEvent.click(screen.getByTestId("eval-run-button"));
    const select = screen.getByLabelText("Model for this run") as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
    expect(select.options[0]).toHaveTextContent("Agent default (gpt-test)");
  });

  it("empty models list shows the hint", async () => {
    models = [];
    mount();
    fireEvent.click(screen.getByTestId("eval-run-button"));
    expect(await screen.findByText(/No models loaded/)).toBeInTheDocument();
  });

  it('running: "Running 3 / 9 cases", disabled, role=status', async () => {
    setRuns([mkRun("running", 3)]);
    mount();
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("Running 3 / 9 cases"));
    expect(screen.getByTestId("eval-run-button")).toBeDisabled();
  });

  it("network error -> message + re-enabled", async () => {
    post.mockRejectedValue(new ApiError("Cannot reach the DevDigest engine", 0, "network_error"));
    mount();
    fireEvent.click(screen.getByTestId("eval-run-button"));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach the DevDigest engine");
    expect(screen.getByTestId("eval-run-button")).toBeEnabled();
  });

  it("400 -> server message shown", async () => {
    post.mockRejectedValue(new ApiError("No eval cases for this agent", 400, "no_eval_cases"));
    mount();
    fireEvent.click(screen.getByTestId("eval-run-button"));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No eval cases for this agent");
  });

  it("500 config_error (missing API key) -> server message shown, action re-enabled (AC-56)", async () => {
    post.mockRejectedValue(new ApiError("OPENAI_API_KEY is not configured", 500, "config_error"));
    mount();
    fireEvent.click(screen.getByTestId("eval-run-button"));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("OPENAI_API_KEY is not configured");
    expect(screen.getByTestId("eval-run-button")).toBeEnabled();
  });

  it("409 -> shows running progress, no alert", async () => {
    post.mockRejectedValue(new ApiError("already running", 409, "eval_run_running"));
    mount();
    fireEvent.click(screen.getByTestId("eval-run-button"));
    setRuns([mkRun("running", 2)]);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Running 2 / 9 cases"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
