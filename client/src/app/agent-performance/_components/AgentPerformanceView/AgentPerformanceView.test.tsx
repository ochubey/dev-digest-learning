import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import agentPerformance from "../../../../../messages/en/agentPerformance.json";
import runs from "../../../../../messages/en/runs.json";
import common from "../../../../../messages/en/common.json";
import sample from "@/test/fixtures/agent-performance.sample.json";
import type { AgentPerformance } from "@/components/agent-performance";

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, push: vi.fn() }),
}));

import { AgentPerformanceView } from "./AgentPerformanceView";

const DATA = sample as unknown as AgentPerformance;
const NOW = new Date("2026-10-18T12:00:00.000Z");
const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, statusText: "x", json: async () => body });
const urlOf = (i: number) => new URL(String(fetchMock.mock.calls[i]![0]));

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agentPerformance, runs, common }}>
        <AgentPerformanceView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  search = "";
  replace.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const card = (label: string) => screen.getByRole("heading", { name: new RegExp(`^${label}`) }).closest("article")!;

describe("AgentPerformanceView data (AC-37..AC-41, AC-55)", () => {
  it("shows the applied period, counted and excluded runs, and the four cards", async () => {
    fetchMock.mockReturnValue(reply(DATA));
    mount();
    await screen.findByText("9 runs counted in this period");
    expect(screen.getByText("Period (UTC): 2026-09-18 12:00 UTC – 2026-10-18 12:00 UTC")).toBeInTheDocument();
    expect(screen.getByText("2 failed, cancelled or running runs not counted")).toBeInTheDocument();
    expect(card("Total runs")).toHaveTextContent("9");
    expect(card("Total cost")).toHaveTextContent("$0.01");
    expect(card("Total cost")).toHaveTextContent("1 run without cost not included");
    expect(within(card("Total cost")).getByRole("button", { name: "Estimate" })).toBeInTheDocument();
    expect(card("Avg accept rate")).toHaveTextContent("64%");
    expect(card("Avg accept rate")).toHaveTextContent("7 of 11 decisions");
    expect(card("Most-active agent")).toHaveTextContent("Security Reviewer");
    expect(card("Most-active agent")).toHaveTextContent("6 runs");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Cost by agent/ })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Cost by model/ })).toBeInTheDocument();
  });

  it("omits the excluded-run note when nothing was excluded", async () => {
    fetchMock.mockReturnValue(reply({ ...DATA, totals: { ...DATA.totals, runs_excluded: 0 } }));
    mount();
    await screen.findByText("9 runs counted in this period");
    expect(screen.queryByText(/not counted/)).toBeNull();
  });

  it("no cost recorded: the cost card and both breakdowns say so, averages are dashes", async () => {
    const noCost = {
      ...DATA,
      totals: { ...DATA.totals, total_cost_usd: null, runs_with_cost: 0, runs_without_cost: 9 },
      cost_by_agent: [],
      cost_by_model: [],
    };
    fetchMock.mockReturnValue(reply(noCost));
    mount();
    await screen.findByText("9 runs counted in this period");
    expect(card("Total cost")).toHaveTextContent("No cost recorded");
    expect(card("Total cost")).not.toHaveTextContent("$");
    expect(screen.getAllByText("No cost recorded yet.")).toHaveLength(2);
  });

  it("accept rate card: 0 decisions is n/a, a low sample is marked", async () => {
    fetchMock.mockReturnValue(reply({ ...DATA, totals: { ...DATA.totals, decisions: 0, accepted: 0, dismissed: 0, accept_rate: null, low_sample: true } }));
    mount();
    await screen.findByText("9 runs counted in this period");
    expect(card("Avg accept rate")).toHaveTextContent("n/a · 0 decisions");
    expect(card("Avg accept rate")).not.toHaveTextContent("low sample");
    cleanup();
    fetchMock.mockReturnValue(reply({ ...DATA, totals: { ...DATA.totals, decisions: 3, accepted: 2, dismissed: 1, accept_rate: 2 / 3, low_sample: true } }));
    mount();
    await waitFor(() => expect(card("Avg accept rate")).toHaveTextContent("low sample"));
    expect(card("Avg accept rate")).toHaveTextContent("2 of 3 decisions");
  });
});

describe("AgentPerformanceView period (AC-31..AC-36, AC-62)", () => {
  it("defaults to 30 days ending now, with the 30 days option selected", async () => {
    fetchMock.mockReturnValue(reply(DATA));
    mount();
    await screen.findByText("9 runs counted in this period");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(0).pathname).toBe("/agent-performance");
    expect(urlOf(0).searchParams.get("from")).toBe("2026-09-18T12:00:00.000Z");
    expect(urlOf(0).searchParams.get("to")).toBe("2026-10-18T12:00:00.000Z");
    expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked();
  });

  it("reads a custom range from the URL as UTC day bounds", async () => {
    search = "range=custom&start=2026-09-01&end=2026-09-30";
    fetchMock.mockReturnValue(reply(DATA));
    mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(urlOf(0).searchParams.get("from")).toBe("2026-09-01T00:00:00.000Z");
    expect(urlOf(0).searchParams.get("to")).toBe("2026-10-01T00:00:00.000Z");
    expect(screen.getByRole("radio", { name: "Custom" })).toBeChecked();
  });

  it("falls back to 30 days for an unknown or invalid period", async () => {
    search = "range=7d";
    fetchMock.mockReturnValue(reply(DATA));
    mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(urlOf(0).searchParams.get("from")).toBe("2026-09-18T12:00:00.000Z");
    expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked();
  });

  it("selecting 1 day requests now-1d once, keeps the choice in the URL", async () => {
    fetchMock.mockReturnValue(reply(DATA));
    mount();
    await screen.findByText("9 runs counted in this period");
    fireEvent.click(screen.getByRole("radio", { name: "1 day" }));
    expect(replace).toHaveBeenCalledWith("/agent-performance?range=1d");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(urlOf(1).searchParams.get("from")).toBe("2026-10-17T12:00:00.000Z");
    expect(urlOf(1).searchParams.get("to")).toBe("2026-10-18T12:00:00.000Z");
  });

  it("applies a custom range with the day after the end date as the exclusive bound", async () => {
    fetchMock.mockReturnValue(reply(DATA));
    mount();
    await screen.findByText("9 runs counted in this period");
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-09-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(replace).toHaveBeenCalledWith("/agent-performance?range=custom&start=2026-09-01&end=2026-09-30");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(urlOf(1).searchParams.get("from")).toBe("2026-09-01T00:00:00.000Z");
    expect(urlOf(1).searchParams.get("to")).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("AgentPerformanceView states (AC-60..AC-64)", () => {
  it("loading: skeleton region, no metric, table or number-like placeholder", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    mount();
    const region = screen.getByRole("status", { name: "Loading agent performance" });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Total runs")).toBeNull();
    expect(screen.queryByText(/n\/a|—/)).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("error: message and Retry, no metric; Retry repeats the same GET", async () => {
    fetchMock.mockReturnValueOnce(reply({ error: "boom" }, 500)).mockReturnValue(reply(DATA));
    mount();
    expect(await screen.findByText("Could not load agent performance.")).toBeInTheDocument();
    expect(screen.queryByText("Total runs")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText(/counted in this period/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("9 runs counted in this period");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(urlOf(1).search).toBe(urlOf(0).search);
  });

  it("no counted runs: empty state with the period and the excluded note, no cards or table", async () => {
    fetchMock.mockReturnValue(
      reply({
        ...DATA,
        totals: { ...DATA.totals, runs: 0, total_cost_usd: null, accept_rate: null, decisions: 0, accepted: 0, dismissed: 0 },
        most_active: null,
        cost_by_agent: [],
        cost_by_model: [],
      }),
    );
    mount();
    expect(await screen.findByText("No agent runs in this period")).toBeInTheDocument();
    expect(screen.getByText("Period (UTC): 2026-09-18 12:00 UTC – 2026-10-18 12:00 UTC")).toBeInTheDocument();
    expect(screen.getByText("Choose a longer period or run a review.")).toBeInTheDocument();
    expect(screen.getByText("2 failed, cancelled or running runs not counted")).toBeInTheDocument();
    expect(screen.queryByText("Total runs")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("Cost by agent")).toBeNull();
    expect(screen.getByRole("radio", { name: "30 days" })).toBeInTheDocument();
  });

  it("no agents at all: 'No agents yet' with a link to /agents", async () => {
    fetchMock.mockReturnValue(
      reply({ ...DATA, totals: { ...DATA.totals, runs: 0, runs_excluded: 0 }, agents: [], most_active: null, cost_by_agent: [], cost_by_model: [] }),
    );
    mount();
    expect(await screen.findByText("No agents yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Agents" })).toHaveAttribute("href", "/agents");
    expect(screen.queryByText("No agent runs in this period")).toBeNull();
  });
});

describe("AgentPerformanceView read-only (AC-73)", () => {
  it("sends only GET /agent-performance across load, sort, expand, retry and period change", async () => {
    fetchMock.mockReturnValueOnce(reply({ error: "boom" }, 500)).mockReturnValue(reply(DATA));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByText("9 runs counted in this period");
    fireEvent.click(screen.getByRole("button", { name: "Runs" }));
    fireEvent.click(screen.getByRole("button", { name: /Security Reviewer/ }));
    fireEvent.click(screen.getByRole("radio", { name: "1 day" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit | undefined)?.method ?? "GET").toBe("GET");
      expect(new URL(String(call[0])).pathname).toBe("/agent-performance");
    }
  });
});
