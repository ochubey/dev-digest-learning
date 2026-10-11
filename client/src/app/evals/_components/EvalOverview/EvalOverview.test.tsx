import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalOverview as Overview } from "@devdigest/shared";
import evalsOverview from "../../../../../messages/en/evalsOverview.json";
import evalsShared from "../../../../../messages/en/evalsShared.json";
import { mkRun } from "@/app/evals/fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const get = vi.fn();
/** Per-agent run history served for `/agents/:id/eval-runs`; the overview payload for everything else. */
let history: ReturnType<typeof mkRun>[] = [];
let overview: unknown = null;
const route = (url: string) =>
  url.includes("/eval-runs") ? Promise.resolve({ items: history, next_cursor: null }) : Promise.resolve(overview);
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, get: (...a: unknown[]) => get(...a) } };
});

import { EvalOverview } from "./EvalOverview";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ evalsOverview, evalsShared }}>
        <EvalOverview />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const agent = (id: string, name: string, latest: ReturnType<typeof mkRun> | null) => ({
  agent_id: id,
  name,
  model: "gpt-test",
  version: 2,
  latest,
  previous: null,
});

beforeEach(() => {
  get.mockReset();
  push.mockReset();
  history = [];
  overview = null;
  get.mockImplementation(route);
});
afterEach(cleanup);

describe("EvalOverview", () => {
  it('agent with runs (version, time, "X/Y pass", three %) and without ("No eval runs yet")', async () => {
    const data: Overview = {
      agents: [
        agent("a1", "Security reviewer", mkRun()),
        agent("a2", "Style reviewer", null),
      ],
      recent: [],
    };
    overview = data;
    mount();
    const rows = await screen.findAllByTestId("eval-agent-row");
    expect(rows).toHaveLength(2);
    const first = within(rows[0]!);
    expect(first.getByText("Security reviewer")).toBeInTheDocument();
    expect(first.getByText("gpt-test")).toBeInTheDocument();
    expect(first.getByText(/^Last run v2 · .*2026.* · 6\/8 pass$/)).toBeInTheDocument();
    for (const [label, pct] of [["Recall", "88%"], ["Prec", "50%"], ["Cite", "100%"]] as const) {
      const big = first.getByText(pct);
      expect(big).toBeInTheDocument();
      expect(first.getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(first.getByText("88%")).toHaveStyle({ color: "var(--accent)" });
    expect(first.getByText("50%")).toHaveStyle({ color: "var(--ok)" });
    expect(first.getByText("100%")).toHaveStyle({ color: "var(--warn)" });
    const empty = within(rows[1]!);
    expect(empty.getByText("No eval runs yet")).toBeInTheDocument();
    expect(empty.queryByText(/Last run/)).toBeNull();
    expect(empty.queryByTestId("eval-sparkline")).toBeNull();
  });

  it("6 recent rows newest first; row/agent click -> /evals/<id>", async () => {
    const recent = Array.from({ length: 8 }, (_, i) =>
      mkRun({
        id: `r${i}`,
        agent_id: i === 0 ? "a2" : "a1",
        agent_name: i === 0 ? "Style reviewer" : "Security reviewer",
        started_at: `2026-10-0${i + 1}T10:00:00Z`,
      }),
    );
    overview = { agents: [agent("a1", "Security reviewer", mkRun())], recent };
    mount();
    await screen.findAllByTestId("eval-agent-row");
    const rows = screen.getAllByTestId("eval-recent-run-row");
    expect(rows).toHaveLength(6);
    // r7 is the newest, r0 (a2) is the oldest and is cut off.
    expect(within(rows[0]!).getByText(/Oct 8, 2026/)).toBeInTheDocument();
    expect(within(rows[5]!).getByText(/Oct 3, 2026/)).toBeInTheDocument();
    fireEvent.click(rows[0]!);
    expect(push).toHaveBeenLastCalledWith("/evals/a1");
    fireEvent.click(screen.getByTestId("eval-agent-row"));
    expect(push).toHaveBeenLastCalledWith("/evals/a1");
  });

  it('no agents -> "No agents yet" + link; loading; error + Retry', async () => {
    overview = { agents: [], recent: [] };
    mount();
    expect(screen.getByRole("status", { name: "Loading eval dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("No agents yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Agents" })).toHaveAttribute("href", "/agents");
    cleanup();

    get.mockReset();
    get.mockImplementation(route);
    overview = { agents: [agent("a1", "A", null)], recent: [] };
    get.mockRejectedValueOnce(new Error("boom"));
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getAllByTestId("eval-agent-row")).toHaveLength(1));
  });

  it("sparkline from the last finished runs' recall; nothing for a single run", async () => {
    overview = { agents: [agent("a1", "Security reviewer", mkRun())], recent: [] };
    history = [
      mkRun({ id: "x1", started_at: "2026-10-01T10:00:00Z" }),
      mkRun({ id: "x2", started_at: "2026-10-02T10:00:00Z" }),
      mkRun({ id: "x3", started_at: "2026-10-03T10:00:00Z", status: "running" }),
    ];
    mount();
    const row = (await screen.findAllByTestId("eval-agent-row"))[0]!;
    expect(await within(row).findByRole("img", { name: "Recall trend over 2 runs" })).toBeInTheDocument();
    cleanup();

    history = [mkRun({ id: "x1" })];
    mount();
    const single = (await screen.findAllByTestId("eval-agent-row"))[0]!;
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining("/agents/a1/eval-runs")));
    expect(within(single).queryByTestId("eval-sparkline")).toBeNull();
  });

  it("recent rows show three metric bars with percents and X/Y passed", async () => {
    overview = { agents: [agent("a1", "Security reviewer", null)], recent: [mkRun({ metrics: { recall: 0.25, precision: null, citation_accuracy: 1 } })] };
    mount();
    const row = (await screen.findAllByTestId("eval-recent-run-row"))[0]!;
    const r = within(row);
    expect(r.getAllByTestId("eval-metric-bar")).toHaveLength(3);
    expect(r.getByRole("img", { name: "Recall: 25%" })).toBeInTheDocument();
    expect(r.getByRole("img", { name: "Precision: no value" })).toBeInTheDocument();
    expect(r.getByRole("img", { name: "Citation: 100%" })).toBeInTheDocument();
    expect(r.getByText("6/8")).toBeInTheDocument();
  });

  it("title, subtitle and section labels", async () => {
    overview = { agents: [agent("a1", "A", null)], recent: [] };
    mount();
    expect(await screen.findByRole("heading", { level: 1, name: "Eval Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Regression harness across all reviewer agents · pick an agent to see its runs")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent eval runs · all agents" })).toBeInTheDocument();
  });

  it("scoring note present", async () => {
    overview = { agents: [agent("a1", "A", null)], recent: [] };
    mount();
    expect(await screen.findByTestId("eval-scoring-note")).toBeInTheDocument();
  });
});
