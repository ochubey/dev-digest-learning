import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentStats } from "@devdigest/shared";
import agentPerformance from "../../../../../../../../messages/en/agentPerformance.json";
import runs from "../../../../../../../../messages/en/runs.json";
import common from "../../../../../../../../messages/en/common.json";
import sample from "@/test/fixtures/agent-performance.sample.json";

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace }),
}));

import { StatsTab } from "./StatsTab";

const AGENT = { id: "00000000-0000-4000-8000-000000000001", name: "Security Reviewer" } as Agent;
const [SECURITY] = sample.agents as unknown as AgentStats[];
const NO_RUNS_IN_PERIOD = sample.agents.find((a) => a.runs === 0 && a.last_run_at_all_time) as unknown as AgentStats;
const NEVER = sample.agents.find((a) => a.runs === 0 && !a.last_run_at_all_time) as unknown as AgentStats;

const fetchMock = vi.fn();
function reply(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, statusText: "x", json: async () => body });
}
function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agentPerformance, runs, common }}>
        <StatsTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
const urlOf = (i: number) => new URL(String(fetchMock.mock.calls[i]![0]));

beforeEach(() => {
  search = "tab=stats";
  replace.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("StatsTab requests (AC-67, AC-73)", () => {
  it("requests exactly the from/to in the URL and shows the applied period", async () => {
    search = "tab=stats&from=2026-09-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z";
    fetchMock.mockReturnValue(reply(SECURITY));
    renderTab();
    await screen.findByText("60%");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const u = urlOf(0);
    expect(u.pathname).toBe(`/agents/${AGENT.id}/stats`);
    expect(u.searchParams.get("from")).toBe("2026-09-01T00:00:00.000Z");
    expect(u.searchParams.get("to")).toBe("2026-10-01T00:00:00.000Z");
    expect(screen.getByText("Period (UTC): 2026-09-18 12:00 UTC – 2026-10-18 12:00 UTC")).toBeInTheDocument();
  });

  it("without from/to requests the 30 days ending now", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-18T12:00:00.000Z") });
    fetchMock.mockReturnValue(reply(SECURITY));
    renderTab();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(urlOf(0).searchParams.get("from")).toBe("2026-09-18T12:00:00.000Z");
    expect(urlOf(0).searchParams.get("to")).toBe("2026-10-18T12:00:00.000Z");
  });

  it("sends only GET requests, also across retry and period change", async () => {
    fetchMock.mockReturnValueOnce(reply({ error: "boom" }, 500)).mockReturnValue(reply(SECURITY));
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByText("60%");
    fireEvent.click(screen.getByRole("radio", { name: "1 day" }));
    for (const call of fetchMock.mock.calls) {
      const method = (call[1] as RequestInit | undefined)?.method ?? "GET";
      expect(method).toBe("GET");
      expect(String(call[0])).toMatch(/\/agents\/[^/]+\/stats\?/);
    }
  });

  it("applying a preset writes absolute from/to to the URL and keeps the tab", async () => {
    fetchMock.mockReturnValue(reply(SECURITY));
    renderTab();
    await screen.findByText("60%");
    fireEvent.click(screen.getByRole("radio", { name: "1 day" }));
    expect(replace).toHaveBeenCalledTimes(1);
    const url = new URL(String(replace.mock.calls[0]![0]), "http://x");
    expect(url.pathname).toBe(`/agents/${AGENT.id}`);
    expect(url.searchParams.get("tab")).toBe("stats");
    const from = Date.parse(url.searchParams.get("from")!);
    const to = Date.parse(url.searchParams.get("to")!);
    expect(to - from).toBe(86_400_000);
  });
});

describe("StatsTab metrics (AC-69)", () => {
  it("shows the same texts as the dashboard row for the same agent", async () => {
    fetchMock.mockReturnValue(reply(SECURITY));
    renderTab();
    await screen.findByText("60%");
    expect(screen.getByText("RUNS").nextSibling).toHaveTextContent(/^6$/);
    expect(screen.getByText("TOTAL COST").parentElement).toHaveTextContent("$0.01");
    expect(screen.getByText("AVG COST/RUN").parentElement).toHaveTextContent("$0.0025");
    expect(screen.getByText("AVG DURATION").nextSibling).toHaveTextContent("14.2 s");
    expect(screen.getByText("6/10")).toBeInTheDocument();
    expect(screen.queryByText("low sample")).toBeNull();
    expect(screen.getByText("6 accepted · 4 dismissed · 2 pending")).toBeInTheDocument();
    expect(screen.getByText("2026-10-18 09:30 UTC")).toBeInTheDocument();
    expect(screen.getByText("6 runs counted in this period")).toBeInTheDocument();
    expect(screen.getByText("2 failed, cancelled or running runs not counted")).toBeInTheDocument();
    expect(screen.getByText("1 run without cost not included")).toBeInTheDocument();
  });

  it("labels both cost metrics as an Estimate and the legend opens by keyboard focus (AC-58)", async () => {
    fetchMock.mockReturnValue(reply(SECURITY));
    renderTab();
    await screen.findByText("60%");
    const labels = screen.getAllByRole("button", { name: "Estimate" });
    expect(labels).toHaveLength(2);
    fireEvent.focus(labels[0]!);
    expect(screen.getByRole("tooltip")).toHaveTextContent("No reconciled billing data exists in DevDigest.");
  });

  it("null cost and duration show the no-cost text and em dashes, not zeros", async () => {
    fetchMock.mockReturnValue(
      reply({ ...SECURITY, total_cost_usd: null, avg_cost_usd: null, avg_latency_ms: null, runs_without_cost: 6 }),
    );
    renderTab();
    await screen.findByText("60%");
    expect(screen.getByText("TOTAL COST").parentElement).toHaveTextContent("No cost recorded");
    expect(screen.getByText("AVG COST/RUN").parentElement).toHaveTextContent("—");
    expect(screen.getByText("AVG DURATION").nextSibling).toHaveTextContent("—");
  });

  it("renders the agent name inside data as plain text (AC-75)", async () => {
    fetchMock.mockReturnValue(reply({ ...SECURITY, agent_name: "<img src=x onerror=alert(1)>" }));
    const { container } = renderTab();
    await screen.findByText("60%");
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("StatsTab states (AC-70)", () => {
  it("shows a busy skeleton and no metric values while loading", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderTab();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("RUNS")).toBeNull();
  });

  it("shows an error with Retry and no metric values on failure; Retry repeats the same GET", async () => {
    search = "tab=stats&from=2026-09-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z";
    fetchMock.mockReturnValueOnce(reply({ error: "boom" }, 500)).mockReturnValue(reply(SECURITY));
    renderTab();
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Could not load the stats for this agent.")).toBeInTheDocument();
    expect(screen.queryByText("RUNS")).toBeNull();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findByText("60%");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(String(fetchMock.mock.calls[0]![0]));
  });

  it("0 counted runs: 'No runs in this period' with the earlier last run, no zero metrics", async () => {
    fetchMock.mockReturnValue(reply(NO_RUNS_IN_PERIOD));
    renderTab();
    await screen.findByText("No runs in this period");
    expect(screen.getByText(/^No runs in period · last 2026-08-01 08:00 UTC$/)).toBeInTheDocument();
    expect(screen.queryByText("RUNS")).toBeNull();
  });

  it("0 counted runs and never run: says Never run", async () => {
    fetchMock.mockReturnValue(reply(NEVER));
    renderTab();
    await screen.findByText("No runs in this period");
    expect(screen.getByText("Never run")).toBeInTheDocument();
  });

  it("low sample is marked when decisions are 1..4", async () => {
    fetchMock.mockReturnValue(reply({ ...SECURITY, accepted: 2, dismissed: 1, decisions: 3, accept_rate: 2 / 3, low_sample: true }));
    renderTab();
    await screen.findByText("67%");
    expect(screen.getByText("low sample")).toBeInTheDocument();
  });
});

