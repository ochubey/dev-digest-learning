import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, MultiAgentRun } from "@devdigest/shared";
import multiAgent from "../../../../../../../messages/en/multiAgent.json";
import prReview from "../../../../../../../messages/en/prReview.json";

const h = vi.hoisted(() => ({
  replace: vi.fn(),
  refetch: vi.fn(),
  search: new URLSearchParams(),
  run: {} as Record<string, unknown>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: h.replace }),
  usePathname: () => "/repos/r1/multi-agent/m1",
  useSearchParams: () => h.search,
}));
vi.mock("@/lib/hooks/multi-agent", () => ({ useMultiAgentRun: () => h.run }));
vi.mock("@/lib/hooks/core", () => ({
  usePulls: () => ({ data: [{ id: "pr1", number: 482, title: "Fix token check", head_sha: "abc" }] }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [] }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ activeRepo: { full_name: "o/r" } }) }));
vi.mock("../../../pulls/[number]/_components/RunTraceDrawer", () => ({
  default: (p: { runId: string; running: boolean }) => (
    <div data-testid="trace-drawer">{`${p.runId}:${p.running}`}</div>
  ),
}));

import { ApiError } from "@/lib/api";
import { MultiAgentResults } from "./MultiAgentResults";

afterEach(cleanup);
beforeEach(() => {
  h.replace.mockReset();
  h.refetch.mockReset();
  h.search = new URLSearchParams();
});

const col = (runId: string, name: string, status: AgentColumn["status"] = "done"): AgentColumn => ({
  run_id: runId,
  agent_id: `ag-${runId}`,
  agent_name: name,
  provider: "openai",
  model: "gpt-4.1",
  status,
  error: null,
  verdict: null,
  score: 80,
  summary: "sum",
  duration_ms: 1000,
  cost_usd: 0.01,
  findings: [],
});

function data(columns: AgentColumn[] = [col("r1", "Security"), col("r2", "Perf"), col("r3", "Style")]): MultiAgentRun {
  return {
    id: "m1",
    pr_id: "pr1",
    pr_number: 482,
    ran_at: "2026-10-11T10:00:00Z",
    agent_count: columns.length,
    total_duration_ms: 12_300,
    total_cost_usd: 0.42,
    columns,
    conflicts: [],
    groups: [],
  };
}

function setRun(over: Record<string, unknown>) {
  h.run = { isLoading: false, isError: false, error: null, data: undefined, refetch: h.refetch, ...over };
}

function renderResults() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent, prReview }}>
      <MultiAgentResults repoId="r1" id="m1" />
    </NextIntlClientProvider>,
  );
}

describe("MultiAgentResults", () => {
  it('header: Configure run, title, "3 agents · parallel", Columns/Tabs switch, "#482 title", total time and cost', () => {
    setRun({ data: data() });
    renderResults();
    expect(screen.getByText("Multi-Agent Review")).toBeInTheDocument();
    expect(screen.getByText("3 agents · parallel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tabs" })).toBeInTheDocument();
    expect(screen.getByText("#482")).toBeInTheDocument();
    expect(screen.getByText("Fix token check")).toBeInTheDocument();
    expect(screen.getByText("12.3s · $0.42")).toBeInTheDocument();
    expect(screen.getAllByTestId("agent-column")).toHaveLength(3);
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tabs" }));
    expect(h.replace).toHaveBeenCalledWith("/repos/r1/multi-agent/m1?view=tabs");
  });

  it("Configure run href carries pr and all column agent ids", () => {
    setRun({ data: data() });
    renderResults();
    const link = screen.getByRole("button", { name: "Configure run" }).closest("a");
    expect(link).toHaveAttribute("href", "/repos/r1/multi-agent?pr=482&agents=ag-r1%2Cag-r2%2Cag-r3");
  });

  it("?view=tabs renders Tabs mode", () => {
    h.search = new URLSearchParams("view=tabs");
    setRun({ data: data() });
    renderResults();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.queryAllByTestId("agent-column")).toHaveLength(0);
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tabs" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Columns" })).toHaveAttribute("aria-pressed", "false");
  });

  it("loading -> skeleton; 404 -> \"Multi-agent run not found\" + link; 500 -> error with Retry", () => {
    setRun({ isLoading: true });
    const loading = renderResults();
    expect(screen.getByTestId("results-skeleton")).toBeInTheDocument();
    loading.unmount();

    setRun({ isError: true, error: new ApiError("nope", 404) });
    const nf = renderResults();
    expect(screen.getByText("Multi-agent run not found")).toBeInTheDocument();
    expect(screen.getByText("Configure run").closest("a")).toHaveAttribute("href", "/repos/r1/multi-agent");
    nf.unmount();

    setRun({ isError: true, error: new ApiError("boom", 500) });
    renderResults();
    expect(screen.getByText("Couldn't load this multi-agent run")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("empty columns show \"No agent runs left in this review.\"", () => {
    setRun({ data: data([]) });
    renderResults();
    expect(screen.getByText("No agent runs left in this review.")).toBeInTheDocument();
  });

  it("View trace opens the drawer with the run id and running flag", () => {
    setRun({ data: data([col("r1", "Security"), col("r2", "Perf", "running")]) });
    renderResults();
    fireEvent.click(screen.getAllByText("View trace")[1]!);
    expect(screen.getByTestId("trace-drawer")).toHaveTextContent("r2:true");
  });
});
