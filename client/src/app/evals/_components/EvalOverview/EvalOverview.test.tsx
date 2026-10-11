import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalOverview as Overview } from "@devdigest/shared";
import evalsDashboard from "../../../../../messages/en/evalsDashboard.json";
import evalsShared from "../../../../../messages/en/evalsShared.json";
import { mkRun } from "@/app/evals/fixtures";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const get = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, get: (...a: unknown[]) => get(...a) } };
});

import { EvalOverview } from "./EvalOverview";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ evalsDashboard, evalsShared }}>
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
    get.mockResolvedValue(data);
    mount();
    const rows = await screen.findAllByTestId("eval-agent-row");
    expect(rows).toHaveLength(2);
    const first = within(rows[0]!);
    expect(first.getByText("Security reviewer")).toBeInTheDocument();
    expect(first.getByText("gpt-test")).toBeInTheDocument();
    expect(first.getByText(/v2/)).toBeInTheDocument();
    expect(first.getByText("6/8 pass")).toBeInTheDocument();
    expect(first.getByText("88%")).toBeInTheDocument();
    expect(first.getByText("50%")).toBeInTheDocument();
    expect(first.getByText("100%")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("No eval runs yet")).toBeInTheDocument();
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
    get.mockResolvedValue({ agents: [agent("a1", "Security reviewer", mkRun())], recent });
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
    get.mockResolvedValueOnce({ agents: [], recent: [] });
    mount();
    expect(screen.getByRole("status", { name: "Loading eval dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("No agents yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Agents" })).toHaveAttribute("href", "/agents");
    cleanup();

    get.mockReset();
    get.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ agents: [agent("a1", "A", null)], recent: [] });
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getAllByTestId("eval-agent-row")).toHaveLength(1));
  });

  it("scoring note present", async () => {
    get.mockResolvedValue({ agents: [agent("a1", "A", null)], recent: [] });
    mount();
    expect(await screen.findByTestId("eval-scoring-note")).toBeInTheDocument();
  });
});
