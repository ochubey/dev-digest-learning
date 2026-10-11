import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalSuiteRun } from "@devdigest/shared";
import evalsShared from "../../../../messages/en/evalsShared.json";
import { MetricStrip } from "./MetricStrip";

afterEach(cleanup);

function run(over: Partial<EvalSuiteRun> = {}): EvalSuiteRun {
  return {
    id: "r1",
    agent_id: "a1",
    agent_version: 3,
    status: "completed",
    error: null,
    cases_total: 8,
    cases_done: 8,
    metrics: { recall: 0.875, precision: 0.5, citation_accuracy: 1 },
    counts: { cases_passed: 6 } as EvalSuiteRun["counts"],
    duration_ms: null,
    cost_usd: null,
    started_at: "2026-10-11T10:00:00Z",
    finished_at: null,
    ...over,
  };
}

const ui = (el: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ evalsShared }}>
      {el}
    </NextIntlClientProvider>,
  );

describe("MetricStrip", () => {
  it('"88%" "▲ 13pt"; "▼"', () => {
    const prev = run({ metrics: { recall: 0.75, precision: 0.75, citation_accuracy: 1 } });
    ui(<MetricStrip latest={run()} previous={prev} agentVersion={3} />);
    const recall = screen.getByTestId("eval-metric-recall");
    expect(within(recall).getByText("88%")).toBeInTheDocument();
    expect(within(recall).getByText("▲ 13pt")).toBeInTheDocument();
    expect(within(screen.getByTestId("eval-metric-precision")).getByText("▼ 25pt")).toBeInTheDocument();
    expect(within(screen.getByTestId("eval-metric-passed")).getByText("6/8")).toBeInTheDocument();
  });

  it("null -> \"—\" with reason tooltip, no delta", () => {
    const latest = run({ metrics: { recall: null, precision: 0.5, citation_accuracy: 1 } });
    const prev = run({ metrics: { recall: 0.5, precision: 0.5, citation_accuracy: 1 } });
    ui(<MetricStrip latest={latest} previous={prev} agentVersion={3} />);
    const recall = screen.getByTestId("eval-metric-recall");
    expect(within(recall).getByText("—")).toBeInTheDocument();
    expect(recall).toHaveAttribute("title", "no must-find cases");
    expect(recall.textContent).not.toMatch(/[▲▼]/);
  });

  it('no finished run -> "No eval runs yet"', () => {
    ui(<MetricStrip latest={null} agentVersion={3} />);
    expect(screen.getByText("No eval runs yet")).toBeInTheDocument();
    expect(screen.queryByTestId("eval-metric-recall")).toBeNull();
  });

  it("run v3 agent v4 -> drift notice", () => {
    ui(<MetricStrip latest={run()} agentVersion={4} />);
    expect(
      screen.getByText("Metrics are from v3; the agent is now v4. Run all evals to update."),
    ).toBeInTheDocument();
  });

  it("no drift notice when versions match", () => {
    ui(<MetricStrip latest={run()} agentVersion={3} />);
    expect(screen.queryByText(/Metrics are from/)).toBeNull();
  });

  it('citation tooltip "grounding pass rate"', () => {
    ui(<MetricStrip latest={run()} agentVersion={3} />);
    expect(screen.getByTestId("eval-metric-citation").getAttribute("title")).toMatch(/grounding pass rate/i);
  });
});
