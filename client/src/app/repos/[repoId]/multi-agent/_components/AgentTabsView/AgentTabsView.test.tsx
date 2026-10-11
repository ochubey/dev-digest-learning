import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, FindingRecord, ReviewRecord } from "@devdigest/shared";
import multiAgent from "../../../../../../../messages/en/multiAgent.json";
import prReview from "../../../../../../../messages/en/prReview.json";

const h = vi.hoisted(() => ({
  reviews: [] as unknown[],
  mutate: vi.fn(),
  isPending: false,
}));
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: h.reviews }),
  useFindingAction: () => ({ mutate: h.mutate, isPending: h.isPending }),
}));

import { AgentTabsView } from "./AgentTabsView";

const finding = (id: string, over: Partial<FindingRecord> = {}): FindingRecord => ({
  id,
  severity: "CRITICAL",
  category: "security",
  title: `Finding ${id}`,
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "Because of reasons.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "rv",
  accepted_at: null,
  dismissed_at: null,
  ...over,
});

const review = (runId: string, findings: FindingRecord[]): ReviewRecord => ({
  id: `rv-${runId}`,
  pr_id: "pr1",
  agent_id: `ag-${runId}`,
  run_id: runId,
  kind: "review",
  verdict: null,
  summary: null,
  score: 80,
  model: "gpt-4.1",
  created_at: "2026-10-11T10:00:00Z",
  findings,
});

const column = (runId: string, name: string, over: Partial<AgentColumn> = {}): AgentColumn => ({
  run_id: runId,
  agent_id: `ag-${runId}`,
  agent_name: name,
  provider: "openai",
  model: "gpt-4.1",
  status: "done",
  error: null,
  verdict: null,
  score: 87,
  summary: `${name} summary text`,
  duration_ms: 9100,
  cost_usd: 0.18,
  findings: [],
  ...over,
});

const COLUMNS = [column("r1", "Security"), column("r2", "Perf", { score: 64 }), column("r3", "Style", { status: "running", score: null, duration_ms: null, cost_usd: null })];

function renderTabs(onOpenTrace = vi.fn()) {
  const ui = () => (
    <NextIntlClientProvider locale="en" messages={{ multiAgent, prReview }}>
      <AgentTabsView columns={COLUMNS} prId="pr1" onOpenTrace={onOpenTrace} />
    </NextIntlClientProvider>
  );
  const r = render(ui());
  return { ...r, again: () => r.rerender(ui()) };
}

beforeEach(() => {
  h.reviews = [review("r1", [finding("f1")]), review("r2", [finding("f2", { title: "Perf finding" })])];
  h.mutate.mockReset();
  h.isPending = false;
});
afterEach(cleanup);

describe("AgentTabsView", () => {
  it("tabs and header; FindingCard with confidence, suggested fix, Accept, Dismiss, Turn into eval case", () => {
    renderTabs();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Security87", "Perf64", "StyleRunning"]);
    expect(tabs[0]!).toHaveAttribute("aria-selected", "true");

    // header of the selected agent
    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Security summary text")).toBeInTheDocument();
    expect(screen.getByText(/9\.1s · \$0\.18 · Score 87/)).toBeInTheDocument();
    expect(screen.getByText("View trace")).toBeInTheDocument();

    // only this run's findings
    expect(screen.getByText("Finding f1")).toBeInTheDocument();
    expect(screen.queryByText("Perf finding")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Finding f1"));
    expect(screen.getByText("Suggested fix")).toBeInTheDocument();
    expect(screen.getByText("Move the key to an environment variable.")).toBeInTheDocument();
    expect(screen.getByText(/95|0\.95/)).toBeInTheDocument();
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
    expect(screen.getByText("Turn into eval case")).toBeInTheDocument();

    // switching tabs swaps the list
    fireEvent.click(tabs[1]!);
    expect(screen.getByText("Perf finding")).toBeInTheDocument();
    expect(screen.queryByText("Finding f1")).not.toBeInTheDocument();
  });

  it("Accept calls the finding action with prId and the card shows Accepted", () => {
    const { again } = renderTabs();
    fireEvent.click(screen.getByText("Finding f1"));
    fireEvent.click(screen.getByText("Accept"));
    expect(h.mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr1" });

    // the same ["reviews", prId] query refetches with the persisted state
    h.reviews = [review("r1", [finding("f1", { accepted_at: "2026-10-11T11:00:00Z" })]), review("r2", [])];
    again();
    const card = document.querySelector('[data-finding-id="f1"]') as HTMLElement;
    expect(within(card).getByText(prReview.finding.accepted)).toBeInTheDocument();
  });

  it("View trace opens the drawer for the selected run", () => {
    const onOpenTrace = vi.fn();
    renderTabs(onOpenTrace);
    fireEvent.click(screen.getAllByRole("tab")[1]!);
    fireEvent.click(screen.getByText("View trace"));
    expect(onOpenTrace).toHaveBeenLastCalledWith(expect.objectContaining({ run_id: "r2" }), false);

    fireEvent.click(screen.getAllByRole("tab")[2]!);
    fireEvent.click(screen.getByText("View trace"));
    expect(onOpenTrace).toHaveBeenLastCalledWith(expect.objectContaining({ run_id: "r3" }), true);
  });
});
