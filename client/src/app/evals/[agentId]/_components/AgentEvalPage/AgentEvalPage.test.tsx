import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalSuiteRun } from "@devdigest/shared";
import evalsDashboard from "../../../../../../messages/en/evalsDashboard.json";
import evalsShared from "../../../../../../messages/en/evalsShared.json";
import { mkDetail, mkRun } from "@/app/evals/fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  };
});

import { AgentEvalPage } from "./AgentEvalPage";

const latest = mkRun({ id: "r2", agent_version: 2, started_at: "2026-10-05T10:00:00Z", metrics: { recall: 0.75, precision: 0.5, citation_accuracy: 1 } });
const previous = mkRun({ id: "r1", agent_version: 1, started_at: "2026-10-01T10:00:00Z", metrics: { recall: 0.5, precision: 0.5, citation_accuracy: 1 } });

const overview = {
  agents: [
    { agent_id: "a1", name: "Security reviewer", model: "gpt-test", version: 2, latest, previous },
    { agent_id: "a2", name: "Style reviewer", model: "claude-test", version: 1, latest: null, previous: null },
  ],
  recent: [],
};

let pages: { items: EvalSuiteRun[]; next_cursor: string | null }[] = [];

function route(url: string): unknown {
  if (url.startsWith("/evals/overview")) return overview;
  if (url.startsWith("/agents/a1/eval-cases")) return [{ id: "c1" }, { id: "c2" }];
  if (url.startsWith("/agents/a1/eval-runs")) return url.includes("cursor=") ? pages[1] : pages[0];
  if (url.startsWith("/eval-runs/compare")) return { a: mkDetail(previous), b: mkDetail(latest) };
  if (url.startsWith("/eval-runs/")) return mkDetail({ ...latest, results: [] });
  throw new Error(`unexpected GET ${url}`);
}

function mount(agentId = "a1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ evalsDashboard, evalsShared }}>
        <AgentEvalPage agentId={agentId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const manyRuns = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) =>
    mkRun({ id: `m${offset + i}`, started_at: new Date(Date.UTC(2026, 9, 28 - (offset + i), 10)).toISOString() }),
  );

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  push.mockReset();
  pages = [{ items: [latest, previous], next_cursor: null }];
  get.mockImplementation(async (url: string) => route(url));
});
afterEach(cleanup);

describe("AgentEvalPage", () => {
  it("name/model, metric cards with deltas, Run eval control, table columns", async () => {
    mount();
    expect(await screen.findByRole("heading", { level: 1, name: "Security reviewer" })).toBeInTheDocument();
    expect(screen.getByText(/Model: gpt-test/)).toBeInTheDocument();
    const recall = screen.getByTestId("eval-metric-recall");
    expect(within(recall).getByText("75%")).toBeInTheDocument();
    expect(within(recall).getByText("▲ 25pt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all evals" })).toBeInTheDocument();
    await screen.findAllByTestId("eval-run-row");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Select", "Ran at", "Version", "Status", "Recall", "Precision", "Citation", "Cases passed", "Cost"]);
    const row = screen.getAllByTestId("eval-run-row")[0]!;
    expect(within(row).getByText("v2")).toBeInTheDocument();
    expect(within(row).getByText("Completed")).toBeInTheDocument();
    expect(within(row).getByText("6/8")).toBeInTheDocument();
    expect(within(row).getByText("$0.0123")).toBeInTheDocument();
  });

  it("a failed newest run never becomes latest/previous in the metric cards (AC-59/61)", async () => {
    const failed = mkRun({
      id: "r3",
      status: "failed",
      agent_version: 3,
      started_at: "2026-10-09T10:00:00Z",
      metrics: { recall: null, precision: null, citation_accuracy: null },
      counts: null,
    });
    pages = [{ items: [failed, latest, previous], next_cursor: null }];
    mount();
    await screen.findAllByTestId("eval-run-row");
    const recall = screen.getByTestId("eval-metric-recall");
    expect(within(recall).getByText("75%")).toBeInTheDocument();
    expect(within(recall).getByText("▲ 25pt")).toBeInTheDocument();
    expect(within(screen.getByTestId("eval-metric-passed")).getByText("6/8")).toBeInTheDocument();
  });

  it("25 runs -> 20 + Load more", async () => {
    pages = [
      { items: manyRuns(20), next_cursor: "cur" },
      { items: manyRuns(5, 20), next_cursor: null },
    ];
    mount();
    await waitFor(() => expect(screen.getAllByTestId("eval-run-row")).toHaveLength(20));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getAllByTestId("eval-run-row")).toHaveLength(25));
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it('switcher + "All agents"; agent id from URL', async () => {
    mount("a1");
    const sw = await screen.findByRole("combobox", { name: "Agent" });
    expect(sw).toHaveValue("a1");
    fireEvent.change(sw, { target: { value: "a2" } });
    expect(push).toHaveBeenLastCalledWith("/evals/a2");
    fireEvent.click(screen.getByRole("button", { name: "All agents" }));
    expect(push).toHaveBeenLastCalledWith("/evals");
    expect(get).toHaveBeenCalledWith(expect.stringContaining("/agents/a1/eval-runs"));
  });

  it("unknown agent id shows not found", async () => {
    mount("zzz");
    expect(await screen.findByText("Agent not found")).toBeInTheDocument();
  });

  it("checkbox names include time + version", async () => {
    mount();
    await screen.findAllByTestId("eval-run-row");
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toHaveAccessibleName(/^Select run from .*Oct 5, 2026.*, version 2$/);
    expect(boxes[1]).toHaveAccessibleName(/^Select run from .*Oct 1, 2026.*, version 1$/);
  });

  it("select 1/2/3 -> Compare enabled only at 2; third replaces earliest; hint text", async () => {
    pages = [{ items: manyRuns(3), next_cursor: null }, { items: [], next_cursor: null }];
    mount();
    await waitFor(() => expect(screen.getAllByTestId("eval-run-select")).toHaveLength(3));
    const boxes = screen.getAllByTestId("eval-run-select") as HTMLInputElement[];
    const compare = screen.getByTestId("eval-compare-button");
    expect(compare).toBeDisabled();
    expect(screen.getByText("Select two runs to compare")).toBeInTheDocument();
    fireEvent.click(boxes[0]!);
    expect(compare).toBeDisabled();
    fireEvent.click(boxes[1]!);
    expect(compare).toBeEnabled();
    expect(screen.queryByText("Select two runs to compare")).toBeNull();
    fireEvent.click(boxes[2]!);
    expect(boxes.map((b) => b.checked)).toEqual([false, true, true]);
    expect(compare).toBeEnabled();
    fireEvent.click(boxes[1]!);
    expect(compare).toBeDisabled();
  });

  it("opens the run drawer and the compare dialog", async () => {
    mount();
    const rows = await screen.findAllByTestId("eval-run-row");
    fireEvent.click(within(rows[0]!).getByRole("button", { name: /Open run from/ }));
    expect(await screen.findByTestId("eval-run-drawer")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("eval-run-drawer")).toBeNull();

    const boxes = screen.getAllByTestId("eval-run-select");
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    fireEvent.click(screen.getByTestId("eval-compare-button"));
    expect(await screen.findByTestId("eval-compare-dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Compare runs · v1 → v2" })).toBeInTheDocument();
  });
});
