import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, FindingGroup } from "@devdigest/shared";
import multiAgent from "../../../../../../../messages/en/multiAgent.json";
import { DisagreementsBlock } from "./DisagreementsBlock";

afterEach(cleanup);

const take = (run: string, persona: string, verdict: FindingGroup["takes"][number]["verdict"], note: string) => ({
  agent_id: `ag-${run}`,
  run_id: run,
  persona,
  verdict,
  note,
});

const groups: FindingGroup[] = [
  {
    id: "g-conflict",
    file: "src/auth.ts",
    start_line: 42,
    end_line: 44,
    title: "Token compared without constant-time check",
    members: [],
    is_conflict: true,
    takes: [
      take("r1", "Security", "CRITICAL", "Timing attack is possible"),
      take("r2", "Perf", "ignored", "Not a performance matter"),
    ],
  },
  {
    id: "g-agree",
    file: "src/db.ts",
    start_line: 7,
    end_line: 7,
    title: "Unbounded query",
    members: [],
    is_conflict: false,
    takes: [take("r1", "Security", "WARNING", "Could be abused"), take("r2", "Perf", "WARNING", "Add a limit")],
  },
];

const cols = (...statuses: AgentColumn["status"][]) => statuses.map((status) => ({ status }));

function renderBlock(g: FindingGroup[], columns: Pick<AgentColumn, "status">[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent }}>
      <DisagreementsBlock groups={g} columns={columns} />
    </NextIntlClientProvider>,
  );
}

describe("DisagreementsBlock", () => {
  it('one cell per finished agent with "did not flag" and original titles', () => {
    renderBlock(groups, cols("done", "done"));
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
    expect(screen.getByText("src/auth.ts:42")).toBeInTheDocument();
    expect(screen.getByText("Token compared without constant-time check")).toBeInTheDocument();
    expect(screen.getByText("Unbounded query")).toBeInTheDocument();
    // one cell per take
    expect(screen.getAllByText("Security")).toHaveLength(2);
    expect(screen.getAllByText("Perf")).toHaveLength(2);
    expect(screen.getByText("CRITICAL")).toBeInTheDocument();
    expect(screen.getAllByText("WARNING")).toHaveLength(2);
    expect(screen.getAllByText("did not flag")).toHaveLength(1);
    expect(screen.getByText("Timing attack is possible")).toBeInTheDocument();
    expect(screen.getByText("Not a performance matter")).toBeInTheDocument();
  });

  it("switch toggles all-with-takes vs conflicts only", () => {
    renderBlock(groups, cols("done", "done"));
    const sw = screen.getByRole("switch", { name: "Show only conflicts" });
    expect(screen.getByText("Show only conflicts")).toBeInTheDocument();
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Unbounded query")).toBeInTheDocument();

    fireEvent.click(sw);
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText("Unbounded query")).not.toBeInTheDocument();
    expect(screen.getByText("Token compared without constant-time check")).toBeInTheDocument();

    fireEvent.click(sw);
    expect(screen.getByText("Unbounded query")).toBeInTheDocument();
  });

  it('all agree + switch on -> "No disagreements: all finished agents agree."', () => {
    renderBlock([groups[1]!], cols("done", "done"));
    expect(screen.queryByText("No disagreements: all finished agents agree.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("No disagreements: all finished agents agree.")).toBeInTheDocument();
  });

  it('one done + two running -> "Disagreements appear when at least two agents have finished."', () => {
    renderBlock(groups, cols("done", "running", "running"));
    expect(
      screen.getByText("Disagreements appear when at least two agents have finished."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Unbounded query")).not.toBeInTheDocument();
  });

  it("badges: Conflict for conflicting groups, All agree otherwise", () => {
    renderBlock(groups, cols("done", "done"));
    expect(screen.getAllByText("Conflict")).toHaveLength(1);
    expect(screen.getAllByText("All agree")).toHaveLength(1);
  });
});
