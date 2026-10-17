import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));
const h = vi.hoisted(() => ({ mutate: vi.fn(), notifyError: vi.fn() }));
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
      { id: "a2", name: "Perf", model: "gpt-4.1", enabled: true },
      { id: "a3", name: "Style", model: "gpt-4.1", enabled: true },
      { id: "a4", name: "Off", model: "gpt-4.1", enabled: false },
    ],
  }),
}));
vi.mock("../../../../../../../lib/hooks/multi-agent", () => ({
  useMultiAgentEstimates: () => ({
    data: [{ agent_id: "a1", sample_size: 2, avg_duration_ms: 6100, avg_cost_usd: 0.1 }],
  }),
  useLaunchMultiAgent: () => ({ mutate: h.mutate, isPending: false }),
}));
vi.mock("../../../../../../../lib/toast", () => ({ notify: { error: (m: string) => h.notifyError(m) } }));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(() => {
  cleanup();
  push.mockReset();
  h.mutate.mockReset();
  h.notifyError.mockReset();
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RunReviewDropdown (smoke)", () => {
  it("renders the trigger label", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });
});

describe("RunReviewDropdown inline agent picker", () => {
  const open = () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" repoId="r1" prNumber={482} />);
    fireEvent.click(screen.getByText("Run Review"));
  };
  const box = (i: number) => screen.getAllByRole("checkbox")[i] as HTMLInputElement;
  const runBtn = () => screen.getByRole("button", { name: /Run multi-agent review/ });

  it("lists only enabled agents, none preselected, button disabled below 2", () => {
    open();
    expect(screen.getByText("Pick agents to run")).toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => !b.checked)).toBe(true);
    expect(screen.getByText("~6s")).toBeInTheDocument();
    expect(runBtn()).toHaveTextContent("Run multi-agent review (0)");
    expect(runBtn()).toBeDisabled();
    fireEvent.click(box(0));
    expect(runBtn()).toBeDisabled();
    fireEvent.click(box(1));
    expect(runBtn()).toHaveTextContent("(2)");
    expect(runBtn()).not.toBeDisabled();
  });

  it("Clear unticks everything", () => {
    open();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(box(0));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect((screen.getAllByRole("checkbox") as HTMLInputElement[]).every((b) => !b.checked)).toBe(true);
  });

  it("launches with the ticked ids and navigates to the results page", () => {
    open();
    fireEvent.click(box(0));
    fireEvent.click(box(2));
    fireEvent.click(runBtn());
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate.mock.calls[0]![0]).toEqual({ prId: "pr1", agentIds: ["a1", "a3"] });
    h.mutate.mock.calls[0]![1].onSuccess({ multi_agent_run_id: "m9", runs: [] });
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent/m9");
  });

  it("falls back to the PR page without multi_agent_run_id; toasts the error", () => {
    open();
    fireEvent.click(box(0));
    fireEvent.click(box(1));
    fireEvent.click(runBtn());
    const opts = h.mutate.mock.calls[0]![1];
    opts.onSuccess({ runs: [] });
    expect(push).toHaveBeenCalledWith("/repos/r1/pulls/482");
    opts.onError(new Error("boom"));
    expect(h.notifyError).toHaveBeenCalledWith("Error: boom");
  });

  it('footer "Configure agents…" goes to Configure run with pr and ticked ids', () => {
    open();
    fireEvent.click(box(1));
    fireEvent.click(screen.getByText("Configure agents…"));
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent?pr=482&agents=a2");
  });

  it("without repoId/prNumber there is no picker and the old configure item stays", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));
    expect(screen.queryByText("Pick agents to run")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Configure agents…"));
    expect(push).toHaveBeenCalledWith("/agents");
  });
});
