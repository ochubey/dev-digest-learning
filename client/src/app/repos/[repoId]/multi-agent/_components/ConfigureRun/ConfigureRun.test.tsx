import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentRunEstimate, PrMeta } from "@devdigest/shared";
import multiAgent from "../../../../../../../messages/en/multiAgent.json";
import prReview from "../../../../../../../messages/en/prReview.json";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  mutate: vi.fn(),
  notifyError: vi.fn(),
  search: new URLSearchParams(),
  pulls: [] as unknown[],
  agents: [] as unknown[],
  estimates: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: h.replace }),
  useSearchParams: () => h.search,
}));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: h.agents }) }));
vi.mock("@/lib/hooks/core", () => ({ usePulls: () => ({ data: h.pulls }) }));
vi.mock("@/lib/hooks/multi-agent", async () => {
  const React = await import("react");
  return {
    useMultiAgentEstimates: () => ({ data: h.estimates }),
    useLaunchMultiAgent: () => {
      const [isPending, setPending] = React.useState(false);
      return {
        isPending,
        mutate: (vars: unknown, opts: unknown) => {
          setPending(true);
          h.mutate(vars, opts);
        },
      };
    },
  };
});
vi.mock("@/lib/toast", () => ({ notify: { error: (m: string) => h.notifyError(m) } }));

import { ApiError } from "@/lib/api";
import { ConfigureRun } from "./ConfigureRun";

const pr = (number: number, title: string, status: PrMeta["status"] = "open"): PrMeta =>
  ({
    id: `pid-${number}`,
    number,
    title,
    author: "me",
    branch: "b",
    base: "main",
    head_sha: "abc",
    additions: 1,
    deletions: 1,
    files_count: 1,
    status,
  }) as PrMeta;

const agent = (id: string, enabled = true): Agent =>
  ({ id, name: `Agent ${id}`, model: "gpt-4.1", enabled }) as Agent;

const est = (
  agent_id: string,
  sample_size: number,
  avg_duration_ms: number | null,
  avg_cost_usd: number | null,
): AgentRunEstimate => ({ agent_id, sample_size, avg_duration_ms, avg_cost_usd });

// a3 is disabled; a1,a2,a4,a5,a6 are the first five enabled agents.
const SEVEN = [agent("a1"), agent("a2"), agent("a3", false), agent("a4"), agent("a5"), agent("a6"), agent("a7")];

function setup(query = "", opts: { pulls?: PrMeta[]; agents?: Agent[]; estimates?: AgentRunEstimate[] } = {}) {
  h.search = new URLSearchParams(query);
  h.pulls = opts.pulls ?? [pr(481, "Older change"), pr(482, "Newer change")];
  h.agents = opts.agents ?? SEVEN;
  h.estimates = opts.estimates ?? [];
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent, prReview }}>
      <ConfigureRun repoId="r1" />
    </NextIntlClientProvider>,
  );
}

const boxes = () => screen.getAllByRole("checkbox") as HTMLInputElement[];
const runButton = () => screen.getByRole("button", { name: /Select agents|Run 1 agent|Run multi-agent review/ });

beforeEach(() => {
  h.push.mockReset();
  h.replace.mockReset();
  h.mutate.mockReset();
  h.notifyError.mockReset();
});
afterEach(cleanup);

describe("ConfigureRun", () => {
  it('two-PR fixture lists "#n · title" newest first', () => {
    setup();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Select a pull request", "#482 · Newer change", "#481 · Older change"]);
  });

  it('no ?pr: "Pick a pull request first", run button disabled', () => {
    setup();
    expect(screen.getByText("Pick a pull request first")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(runButton()).toBeDisabled();
  });

  it('6 enabled + 1 disabled: 7 cards, first 5 enabled checked, others unchecked, estimate and "No run history" forms', () => {
    setup("pr=482", { estimates: [est("a1", 3, 9100, 0.18), est("a2", 2, 4000, null)] });
    const cb = boxes();
    expect(cb).toHaveLength(7);
    // card order a1,a2,a3(disabled),a4,a5,a6,a7
    expect(cb.map((c) => c.checked)).toEqual([true, true, false, true, true, true, false]);
    expect(screen.getByText("≈ 9.1s · $0.18")).toBeInTheDocument();
    expect(screen.getByText("≈ 4.0s")).toBeInTheDocument();
    expect(screen.getAllByText("No run history")).toHaveLength(5);
    expect(screen.getByText("gpt-4.1 · disabled")).toBeInTheDocument();
  });

  it("Select all picks first 5; Clear all at 5 clears", () => {
    setup("pr=482&agents=a1");
    expect(boxes().filter((c) => c.checked)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    // first five agents in card order, including the disabled one
    expect(boxes().map((c) => c.checked)).toEqual([true, true, true, true, true, false, false]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(boxes().every((c) => !c.checked)).toBe(true);
    expect(screen.getByRole("button", { name: "Select all" })).toBeInTheDocument();
  });

  it('5 checked: unchecked boxes disabled + "Up to 5 agents per run"', () => {
    setup("pr=482");
    expect(screen.getByText("Up to 5 agents per run")).toBeInTheDocument();
    const cb = boxes();
    cb.forEach((c) => {
      if (c.checked) expect(c).not.toBeDisabled();
      else expect(c).toBeDisabled();
    });
  });

  it("labels for 0 / 1 / 3 selected and enabled state", () => {
    const one = setup("pr=482&agents=a1");
    expect(runButton()).toHaveTextContent("Run 1 agent");
    expect(runButton()).toBeEnabled();
    one.unmount();

    const three = setup("pr=482&agents=a1,a2,a4");
    expect(runButton()).toHaveTextContent("Run multi-agent review (3)");
    expect(runButton()).toBeEnabled();
    three.unmount();

    setup("pr=482");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(runButton()).toHaveTextContent("Select agents");
    expect(runButton()).toBeDisabled();
  });

  it('estimate line "≈ …s · $… · parallel · 1 without history"', () => {
    setup("pr=482&agents=a1,a2,a4", { estimates: [est("a1", 3, 9100, 0.18), est("a2", 2, 4000, 0.05)] });
    expect(screen.getByText("≈ 9.1s · $0.23 · parallel · 1 without history")).toBeInTheDocument();
  });

  it("run: one mutate call with ids in card order, loading, no second call on double click, push to results URL", () => {
    setup("pr=482&agents=a4,a1");
    const btn = runButton();
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(h.mutate).toHaveBeenCalledTimes(1);
    const [vars, callbacks] = h.mutate.mock.calls[0] as [
      { prId: string; agentIds: string[] },
      { onSuccess: (r: { multi_agent_run_id?: string }) => void },
    ];
    expect(vars).toEqual({ prId: "pid-482", agentIds: ["a1", "a4"] });
    expect(runButton()).toBeDisabled(); // loading
    act(() => callbacks.onSuccess({ multi_agent_run_id: "m9" }));
    expect(h.push).toHaveBeenCalledWith("/repos/r1/multi-agent/m9");
  });

  it("rejecting mutation: toast with server message, PR and selection kept", () => {
    setup("pr=482&agents=a1,a2");
    fireEvent.click(runButton());
    const [, callbacks] = h.mutate.mock.calls[0] as [unknown, { onError: (e: unknown) => void }];
    act(() => callbacks.onError(new ApiError("Provider quota exceeded", 429)));
    expect(h.notifyError).toHaveBeenCalledWith("Provider quota exceeded");
    expect(h.push).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Pull request") as HTMLSelectElement).value).toBe("482");
    expect(boxes().map((c) => c.checked)).toEqual([true, true, false, false, false, false, false]);
  });

  it("merged PR: warning shown, button enabled", () => {
    setup("pr=482&agents=a1", { pulls: [pr(482, "Newer change", "merged")] });
    expect(screen.getByText(prReview.runReview.mergedWarning)).toBeInTheDocument();
    expect(runButton()).toBeEnabled();
  });

  it("?agents=a,b preselects exactly those agents", () => {
    setup("pr=482&agents=a2,a6");
    expect(boxes().map((c) => c.checked)).toEqual([false, true, false, false, false, true, false]);
  });
});
