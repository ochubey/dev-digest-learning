import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { screen, cleanup, within } from "@testing-library/react";
import sample from "@/test/fixtures/agent-performance.sample.json";
import type { AgentPerformance } from "@/components/agent-performance";
import { renderWithIntl } from "@/components/agent-performance/test-utils";
import { CostBreakdown } from "./CostBreakdown";

const DATA = sample as unknown as AgentPerformance;
afterEach(cleanup);

describe("CostBreakdown (AC-55..AC-57)", () => {
  it("lists each agent with amount and share, footer is the server total", () => {
    renderWithIntl(<CostBreakdown costByAgent={DATA.cost_by_agent} costByModel={DATA.cost_by_model} total={DATA.totals.total_cost_usd} />);
    const sec = screen.getByRole("region", { name: /Cost by agent/ });
    const items = within(sec).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Security Reviewer");
    expect(items[0]).toHaveTextContent("$0.01");
    expect(items[0]).toHaveTextContent("85%");
    expect(items[1]).toHaveTextContent("Perf Bot");
    expect(items[1]).toHaveTextContent("$0.0021");
    expect(items[1]).toHaveTextContent("15%");
    expect(within(sec).getByText("Total").parentElement).toHaveTextContent("$0.01");
  });

  it("lists models and keeps the Estimate label in each heading (AC-58)", () => {
    renderWithIntl(<CostBreakdown costByAgent={DATA.cost_by_agent} costByModel={DATA.cost_by_model} total={DATA.totals.total_cost_usd} />);
    const sec = screen.getByRole("region", { name: /Cost by model/ });
    expect(within(sec).getByText("deepseek/deepseek-v4-flash")).toBeInTheDocument();
    expect(within(sec).getByRole("button", { name: "Estimate" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: /Cost by agent/ })).getByRole("button", { name: "Estimate" })).toBeInTheDocument();
  });

  it("shows the footer as the given total, not the sum of rounded entries (AC-56)", () => {
    const parts = [0.00004, 0.00004, 0.00004].map((c, i) => ({ agent_id: `a${i}`, agent_name: `A${i}`, cost_usd: c, runs_with_cost: 1 }));
    renderWithIntl(<CostBreakdown costByAgent={parts} costByModel={[]} total={0.00012} />);
    const sec = screen.getByRole("region", { name: /Cost by agent/ });
    expect(within(sec).getByText("Total").parentElement).toHaveTextContent("$0.0001");
    expect(within(sec).getAllByRole("listitem")[0]).toHaveTextContent("33%");
  });

  it("a real total of 0 lists the entries at 0% and the footer $0.00 (AC-57)", () => {
    const zero = [{ agent_id: "a1", agent_name: "Free Bot", cost_usd: 0, runs_with_cost: 2 }];
    renderWithIntl(<CostBreakdown costByAgent={zero} costByModel={[{ model: "m/free", cost_usd: 0, runs_with_cost: 2 }]} total={0} />);
    const sec = screen.getByRole("region", { name: /Cost by agent/ });
    expect(within(sec).getByRole("listitem")).toHaveTextContent("Free Bot");
    expect(within(sec).getByRole("listitem")).toHaveTextContent("0%");
    expect(within(sec).getByText("Total").parentElement).toHaveTextContent("$0.00");
    expect(screen.queryByText("No cost recorded yet.")).toBeNull();
  });

  it("null total: both breakdowns say No cost recorded yet. and list nothing", () => {
    renderWithIntl(<CostBreakdown costByAgent={[]} costByModel={[]} total={null} />);
    expect(screen.getAllByText("No cost recorded yet.")).toHaveLength(2);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText("Total")).toBeNull();
  });

  it("renders agent and model strings as plain text (AC-75)", () => {
    const { container } = renderWithIntl(
      <CostBreakdown
        costByAgent={[{ agent_id: "x", agent_name: "<b>bold</b>", cost_usd: 1, runs_with_cost: 1 }]}
        costByModel={[{ model: "<i>m</i>", cost_usd: 1, runs_with_cost: 1 }]}
        total={1}
      />,
    );
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
    expect(screen.getByText("<i>m</i>")).toBeInTheDocument();
    expect(container.querySelector("b, i")).toBeNull();
  });
});
