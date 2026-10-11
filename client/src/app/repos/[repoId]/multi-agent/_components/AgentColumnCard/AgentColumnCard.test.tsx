import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, AgentColumnFinding, FindingGroup } from "@devdigest/shared";
import multiAgent from "../../../../../../../messages/en/multiAgent.json";
import { alsoFlaggedBy } from "../MultiAgentResults/helpers";
import { AgentColumnCard } from "./AgentColumnCard";

afterEach(cleanup);

const finding = (id: string, runId: string, agent: string, over: Partial<AgentColumnFinding> = {}): AgentColumnFinding => ({
  id,
  agent_id: `ag-${agent}`,
  agent_name: agent,
  run_id: runId,
  severity: "WARNING",
  category: "security",
  title: `Title ${id}`,
  file: "src/a.ts",
  start_line: 10,
  end_line: 12,
  ...over,
});

const column = (over: Partial<AgentColumn> = {}): AgentColumn => ({
  run_id: "r1",
  agent_id: "ag-Security",
  agent_name: "Security",
  provider: "openai",
  model: "gpt-4.1",
  status: "done",
  error: null,
  verdict: null,
  score: 87,
  summary: null,
  duration_ms: 9100,
  cost_usd: 0.18,
  findings: [],
  ...over,
});

function renderCard(col: AgentColumn, alsoFlagged = new Map<string, string[]>(), onOpenTrace = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent }}>
      <AgentColumnCard column={col} alsoFlagged={alsoFlagged} onOpenTrace={onOpenTrace} />
    </NextIntlClientProvider>,
  );
}

describe("AgentColumnCard", () => {
  it("one column per status: labels, dash until terminal, score when done, footer", () => {
    const cases: [AgentColumn["status"], string][] = [
      ["running", "Running"],
      ["done", "Done"],
      ["failed", "Failed"],
      ["cancelled", "Cancelled"],
    ];
    for (const [status, label] of cases) {
      const { unmount } = renderCard(
        column({
          status,
          score: status === "done" ? 87 : null,
          duration_ms: status === "running" ? null : 9100,
          cost_usd: status === "running" ? null : 0.18,
          findings: status === "done" ? [finding("f1", "r1", "Security"), finding("f2", "r1", "Security")] : [],
        }),
      );
      const card = screen.getByTestId("agent-column");
      expect(within(card).getByText("Security")).toBeInTheDocument();
      expect(within(card).getByText(label)).toBeInTheDocument();
      if (status === "running") {
        expect(within(card).getByText("—")).toBeInTheDocument();
        expect(within(card).queryByText("9.1s · $0.18")).not.toBeInTheDocument();
      } else {
        expect(within(card).getByText("9.1s · $0.18")).toBeInTheDocument();
      }
      if (status === "done") expect(within(card).getByText("87")).toBeInTheDocument();
      else expect(within(card).queryByText("87")).not.toBeInTheDocument();
      expect(within(card).getByText("View trace")).toBeInTheDocument();
      expect(within(card).getByText(status === "done" ? "2 findings" : "0 findings")).toBeInTheDocument();
      unmount();
    }
  });

  it("failed column shows its error; done columns still show findings", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ multiAgent }}>
        <AgentColumnCard
          column={column({ run_id: "r1", status: "failed", agent_name: "Broken", error: "Provider timed out", score: null })}
          alsoFlagged={new Map()}
          onOpenTrace={vi.fn()}
        />
        <AgentColumnCard
          column={column({ run_id: "r2", agent_name: "Perf", findings: [finding("f9", "r2", "Perf")] })}
          alsoFlagged={new Map()}
          onOpenTrace={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    const [failed, done] = screen.getAllByTestId("agent-column");
    expect(within(failed!).getByText("Provider timed out")).toBeInTheDocument();
    expect(within(done!).queryByText("Provider timed out")).not.toBeInTheDocument();
    expect(within(done!).getByText("Title f9")).toBeInTheDocument();
    expect(within(done!).getByText("src/a.ts:10")).toBeInTheDocument();
  });

  it("shows \"No findings\" for a done column and truncates long titles with a tooltip", () => {
    const long = "x".repeat(120);
    const { unmount } = renderCard(column());
    expect(screen.getByText("No findings")).toBeInTheDocument();
    unmount();

    renderCard(column({ findings: [finding("f1", "r1", "Security", { title: long })] }));
    const full = screen.getByTitle(long);
    expect(full).toBeInTheDocument();
    expect(screen.queryByText(long)).not.toBeInTheDocument();
    expect(full.textContent!.length).toBeLessThan(long.length);
  });

  it('"Also flagged by Security" on both items of a two-agent group', () => {
    const security = finding("f1", "r1", "Security");
    const perf = finding("f2", "r2", "Perf");
    const group: FindingGroup = {
      id: "g1",
      file: "src/a.ts",
      start_line: 10,
      end_line: 12,
      title: "Shared",
      members: [security, perf],
      takes: [],
      is_conflict: false,
    };
    const flagged = alsoFlaggedBy([group]);
    render(
      <NextIntlClientProvider locale="en" messages={{ multiAgent }}>
        <AgentColumnCard column={column({ run_id: "r1", agent_name: "Security", findings: [security] })} alsoFlagged={flagged} onOpenTrace={vi.fn()} />
        <AgentColumnCard column={column({ run_id: "r2", agent_id: "ag-Perf", agent_name: "Perf", findings: [perf] })} alsoFlagged={flagged} onOpenTrace={vi.fn()} />
      </NextIntlClientProvider>,
    );
    const [secCard, perfCard] = screen.getAllByTestId("agent-column");
    expect(within(secCard!).getByText("Also flagged by Perf")).toBeInTheDocument();
    expect(within(perfCard!).getByText("Also flagged by Security")).toBeInTheDocument();
  });

  it('View trace calls onOpenTrace(runId, running = status === "running")', () => {
    const onOpenTrace = vi.fn();
    const running = renderCard(column({ run_id: "r-run", status: "running", score: null }), new Map(), onOpenTrace);
    fireEvent.click(screen.getByText("View trace"));
    expect(onOpenTrace).toHaveBeenLastCalledWith(expect.objectContaining({ run_id: "r-run" }), true);
    running.unmount();

    renderCard(column({ run_id: "r-done", status: "done" }), new Map(), onOpenTrace);
    fireEvent.click(screen.getByText("View trace"));
    expect(onOpenTrace).toHaveBeenLastCalledWith(expect.objectContaining({ run_id: "r-done" }), false);
  });
});
