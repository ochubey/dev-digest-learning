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

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ evalsShared }}>
        <RunEvalControl agentId="a1" caseCount={9} model="gpt-test" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue(page([]));
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

  it('running: "Running 3 / 9 cases", disabled, role=status', async () => {
    get.mockResolvedValue(page([mkRun("running", 3)]));
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
    get.mockResolvedValue(page([mkRun("running", 2)]));
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Running 2 / 9 cases"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
