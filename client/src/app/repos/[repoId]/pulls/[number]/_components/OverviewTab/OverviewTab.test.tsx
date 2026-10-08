import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import brief from "../../../../../../../../messages/en/brief.json";
import blast from "../../../../../../../../messages/en/blast.json";
import prReview from "../../../../../../../../messages/en/prReview.json";

const routes: Record<string, () => unknown> = {};
const get = vi.fn(async (url: string) => {
  const key = Object.keys(routes).find((k) => url.endsWith(k));
  if (!key) throw new Error(`unrouted ${url}`);
  return routes[key]!();
});
const post = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, get: (u: string) => get(u), post: (...a: unknown[]) => post(...a) } };
});
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate: vi.fn(), isError: false }),
  useRepoIntelStatus: () => ({ data: { updatedAt: "t0" } }),
}));
const notifyInfo = vi.fn();
vi.mock("@/lib/toast", () => ({
  notify: { info: (...a: unknown[]) => notifyInfo(...a), error: vi.fn(), success: vi.fn() },
}));

import { ApiError } from "@/lib/api";
import type { ReviewRecord } from "@devdigest/shared";
import { OverviewTab } from "./OverviewTab";

const INTENT = {
  summary: "Retry the sync job",
  in_scope: ["retry logic"],
  out_of_scope: ["ui changes"],
  confidence: 0.9,
  sources: [],
  stale: false,
  derived_from_head_sha: "abc",
};
const caller = (file: string) => ({ name: "h", file, line: 1 });
const BLAST = (callers: string[]) => ({
  changed_symbols: [{ name: "foo", file: "src/a.ts", kind: "function" }],
  downstream: [{ symbol: "foo", callers: callers.map(caller), endpoints_affected: [], crons_affected: [] }],
  summary: "Blast sum",
  degraded: false,
  reason: null,
});
const BRIEF = (over: Record<string, unknown> = {}) => ({
  pr_id: "pr1",
  stale: false,
  summary: "Brief summary text",
  intent: { ...INTENT },
  blast: BLAST(["src/r.ts", "src/q.ts"]),
  risks: {
    risks: [
      { kind: "security", title: "Risky", explanation: "x", severity: "high", file_refs: ["src/only-blast.ts"] },
    ],
  },
  review_focus: [{ file: "src/a.ts", line: 5, reason: "look here" }],
  meta: {
    generated_from_head_sha: "abc",
    generated_at: "2026-01-02T03:04:05.000Z",
    provider: "p",
    model: "m",
    schema_attempts: 1,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    missing: [],
    sources: [],
    diff_stats: null,
    input: { estimated_tokens: 1, budget_tokens: 2, truncated: [], blast_degraded_reason: null },
    grounding: { dropped_risks: 0, dropped_refs: 0, dropped_focus: 0, adjusted_lines: 0 },
  },
  ...over,
});

const finding = (severity: string, extra: Record<string, unknown> = {}) => ({
  severity,
  scope: "in",
  dismissed_at: null,
  ...extra,
});
const review = (over: Partial<ReviewRecord> = {}): ReviewRecord =>
  ({
    id: "r1",
    pr_id: "pr1",
    agent_id: "a",
    run_id: "run1",
    agent_name: "Security",
    kind: "review",
    verdict: "request_changes",
    summary: "Verdict summary",
    score: 70,
    model: "m",
    created_at: "2026-01-01",
    findings: [finding("CRITICAL"), finding("LOW")],
    ...over,
  }) as unknown as ReviewRecord;

const onOpenInDiff = vi.fn();

function renderTab(latestReview: ReviewRecord | null = null, paths = ["src/a.ts"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief, blast, prReview }}>
        <OverviewTab
          prId="pr1"
          prBody="The PR body"
          repoId="repo1"
          repoFullName="o/r"
          headSha="abc"
          diffPaths={new Set(paths)}
          onOpenInDiff={onOpenInDiff}
          latestReview={latestReview}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const k of Object.keys(routes)) delete routes[k];
  routes["/brief"] = () => BRIEF();
  routes["/intent"] = () => INTENT;
  routes["/blast"] = () => BLAST(["src/r.ts", "src/q.ts"]);
  routes["/reviews"] = () => [];
  routes["/history"] = () => ({ history: [] });
  post.mockReset();
  onOpenInDiff.mockReset();
  notifyInfo.mockReset();
});
afterEach(cleanup);

const hint = () => screen.queryByText(brief.card.inputsChanged);

describe("OverviewTab", () => {
  it("shows no verdict banner without a review run (AC-50)", async () => {
    renderTab(null);
    await screen.findByText("Brief summary text");
    expect(screen.queryByText("Verdict summary")).not.toBeInTheDocument();
  });

  it("shows the banner with the run's counts when a review exists (AC-50)", async () => {
    renderTab(review());
    expect(await screen.findByText("Verdict summary")).toBeInTheDocument();
    expect(screen.getByText(/2 findings/)).toBeInTheDocument();
    expect(screen.getByText(/1 blocker/)).toBeInTheDocument();
  });

  it("renders intent and blast inside the brief area, once each (AC-5, AC-6)", async () => {
    renderTab(null);
    // Settle on the ready brief first: the card swaps states, remounting its children once.
    await screen.findByText("Brief summary text");
    await waitFor(() => {
      expect(screen.getByText(/Retry the sync job/)).toBeInTheDocument();
      expect(screen.getByText(/retry logic/)).toBeInTheDocument();
      expect(screen.getByTestId("blast-stats")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Retry the sync job/)).toHaveLength(1);
    expect(screen.getAllByTestId("blast-stats")).toHaveLength(1);
  });

  it("renders intent and blast even when the brief is not generated", async () => {
    routes["/brief"] = () => {
      throw new ApiError("nf", 404);
    };
    renderTab(null);
    expect(
      await screen.findByRole("button", { name: brief.card.generate }, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("blast-stats")).toBeInTheDocument();
    expect(await screen.findByText(/retry logic/)).toBeInTheDocument();
  });

  it("clicking a focus item navigates with (file, line)", async () => {
    renderTab(null);
    fireEvent.click(await screen.findByText(/look here/));
    expect(onOpenInDiff).toHaveBeenCalledWith("src/a.ts", 5);
  });

  it("a risk ref outside the diff toasts instead of navigating (AC-41/42)", async () => {
    renderTab(null);
    fireEvent.click(await screen.findByRole("button", { name: /Show details: Risky/ }));
    fireEvent.click(await screen.findByText("src/only-blast.ts"));
    expect(notifyInfo).toHaveBeenCalledWith(brief.card.notInDiff);
    expect(onOpenInDiff).not.toHaveBeenCalled();
  });

  it("shows the inputs-changed hint when the snapshot has no intent but live does", async () => {
    routes["/brief"] = () => BRIEF({ intent: null });
    renderTab(null);
    expect(await screen.findByText(brief.card.inputsChanged)).toBeInTheDocument();
    expect(screen.getByText("Brief summary text")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: brief.card.regenerate }).length).toBeGreaterThan(0);
  });

  it("does not show the hint for reordered callers", async () => {
    routes["/blast"] = () => BLAST(["src/q.ts", "src/r.ts"]);
    renderTab(null);
    await screen.findByTestId("blast-stats");
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining("/blast")));
    expect(hint()).not.toBeInTheDocument();
  });

  describe("inputs-changed hint regenerate", () => {
    const changed = () => {
      routes["/brief"] = () => BRIEF({ intent: null });
    };
    const hintButton = async () => {
      const text = await screen.findByText(brief.card.inputsChanged);
      return text.closest("div")!.querySelector("button") as HTMLButtonElement;
    };

    it("is disabled while the card's own request is in flight", async () => {
      changed();
      post.mockReturnValue(new Promise(() => {}));
      renderTab(null);
      const hintBtn = await hintButton();
      expect(hintBtn).toBeEnabled();
      const headerBtn = screen
        .getAllByRole("button", { name: brief.card.regenerate })
        .find((b) => b !== hintBtn)!;
      fireEvent.click(headerBtn);
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(hintBtn).toBeDisabled());
      expect(hintBtn).toHaveTextContent(brief.card.regenerating);
    });

    it("a 502 from the hint shows an alert with the server text", async () => {
      changed();
      const text = "Risk Brief model (Settings > Models > Risk Brief): X is not configured";
      post.mockRejectedValue(new ApiError(text, 502));
      renderTab(null);
      fireEvent.click(await hintButton());
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(text);
      expect(screen.getByText("Brief summary text")).toBeInTheDocument();
    });

    it("renders the hint above the card body (under the header rows)", async () => {
      changed();
      renderTab(null);
      const h = await screen.findByText(brief.card.inputsChanged);
      const summary = screen.getByText("Brief summary text");
      expect(h.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});
