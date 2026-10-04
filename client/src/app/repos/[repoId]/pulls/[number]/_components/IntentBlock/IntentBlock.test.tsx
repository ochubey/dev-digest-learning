import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import brief from "../../../../../../../../messages/en/brief.json";
import prReview from "../../../../../../../../messages/en/prReview.json";

type IntentData = {
  summary: string;
  in_scope: string[];
  out_of_scope: string[];
  confidence: number;
  sources: { label: string; status: "fetched" | "unavailable" | "error" }[];
  missing_context: string[];
  stale: boolean;
  derived_from_head_sha: string;
};

const state: {
  data: IntentData | undefined;
  isLoading: boolean;
  error: unknown;
  derive: ReturnType<typeof vi.fn>;
  refetch: ReturnType<typeof vi.fn>;
  isPending: boolean;
  deriveError: unknown;
  reviews: unknown[];
} = {
  data: undefined,
  isLoading: false,
  error: null,
  derive: vi.fn(),
  refetch: vi.fn(),
  isPending: false,
  deriveError: null,
  reviews: [],
};

vi.mock("@/lib/hooks/reviews", () => ({
  useIntent: () => ({
    data: state.data,
    isLoading: state.isLoading,
    error: state.error,
    refetch: state.refetch,
  }),
  useRederiveIntent: () => ({ mutate: state.derive, isPending: state.isPending, error: state.deriveError }),
  usePrReviews: () => ({ data: state.reviews }),
}));

import { ApiError } from "@/lib/api";
import { IntentBlock } from "./IntentBlock";

beforeEach(() => {
  state.data = undefined;
  state.isLoading = false;
  state.error = null;
  state.derive = vi.fn();
  state.refetch = vi.fn();
  state.isPending = false;
  state.deriveError = null;
  state.reviews = [];
});
afterEach(cleanup);

const INTENT: IntentData = {
  summary: "Add intent layer",
  in_scope: ["derive intent"],
  out_of_scope: ["billing"],
  confidence: 0.8,
  sources: [{ label: "PR body", status: "fetched" }],
  missing_context: [],
  stale: false,
  derived_from_head_sha: "abc",
};

function renderBlock() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief, prReview }}>
      <IntentBlock prId="pr1" />
    </NextIntlClientProvider>,
  );
}

describe("IntentBlock", () => {
  it("shows a skeleton while loading", () => {
    state.isLoading = true;
    renderBlock();
    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(brief.intent.loadError)).not.toBeInTheDocument();
  });

  it("renders the empty state with a Run Intent button on 404 and derives on click", () => {
    state.error = new ApiError("404 Not Found", 404);
    renderBlock();
    expect(screen.queryByText(brief.intent.loadError)).not.toBeInTheDocument();
    expect(screen.getByText(brief.intent.notDerivedTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run Intent" }));
    expect(state.derive).toHaveBeenCalledTimes(1);
  });

  it("renders the error state with Retry for non-404 errors", () => {
    state.error = new ApiError("500 Server Error", 500);
    renderBlock();
    expect(screen.getByText(brief.intent.loadError)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run Intent" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it("renders a normal intent without stale badge, with an always-on Recalculate button", () => {
    state.data = INTENT;
    renderBlock();
    expect(screen.getByText("Add intent layer")).toBeInTheDocument();
    expect(screen.getByText("• derive intent")).toBeInTheDocument();
    expect(screen.getByText("• billing")).toBeInTheDocument();
    expect(screen.getByText("PR body")).toBeInTheDocument();
    expect(screen.queryByText(brief.intent.stale)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
    expect(state.derive).toHaveBeenCalledTimes(1);
  });

  it("stale intent shows the badge and Recalculate triggers the mutation", () => {
    state.data = { ...INTENT, stale: true };
    renderBlock();
    expect(screen.getByText(brief.intent.stale)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
    expect(state.derive).toHaveBeenCalledTimes(1);
  });

  it("shows a readable rate-limit message with seconds on 429 (empty state)", () => {
    state.error = new ApiError("404 Not Found", 404);
    state.deriveError = new ApiError("429 Too Many Requests", 429, undefined, { retry_after: 12 });
    renderBlock();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Intent was derived recently. Try again in 12 seconds.",
    );
  });

  it("uses the singular for 1 second and shows it next to a stale intent", () => {
    state.data = { ...INTENT, stale: true };
    state.deriveError = new ApiError("429 Too Many Requests", 429, undefined, { retry_after: 1 });
    renderBlock();
    expect(screen.getByRole("alert")).toHaveTextContent("Try again in 1 second.");
  });

  it("shows a generic derive error for non-429 failures", () => {
    state.data = { ...INTENT, stale: true };
    state.deriveError = new ApiError("502 Bad Gateway", 502);
    renderBlock();
    expect(screen.getByRole("alert")).toHaveTextContent(brief.intent.deriveError);
  });

  it("confidence 0: shows the 'Not enough context' card instead of the normal card, with a Recalculate action", () => {
    state.data = { ...INTENT, confidence: 0 };
    renderBlock();
    expect(screen.getByText(brief.intent.insufficientContext)).toBeInTheDocument();
    expect(screen.getByText(brief.intent.insufficientContextBody)).toBeInTheDocument();
    // normal card content is not rendered
    expect(screen.queryByText("Add intent layer")).not.toBeInTheDocument();
    expect(screen.queryByText("� derive intent")).not.toBeInTheDocument();
    // action is available even when the intent is not stale
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
    expect(state.derive).toHaveBeenCalledTimes(1);
  });

  it("confidence 0 still surfaces derive errors", () => {
    state.data = { ...INTENT, confidence: 0 };
    state.deriveError = new ApiError("429 Too Many Requests", 429, undefined, { retry_after: 7 });
    renderBlock();
    expect(screen.getByRole("alert")).toHaveTextContent("Try again in 7 seconds.");
  });

  it("low (non-zero) confidence keeps the normal card", () => {
    state.data = { ...INTENT, confidence: 0.3 };
    renderBlock();
    expect(screen.getByText("Add intent layer")).toBeInTheDocument();
    expect(screen.queryByText(brief.intent.insufficientContext)).not.toBeInTheDocument();
  });
});

describe("IntentBlock: reason next to an unavailable source", () => {
  const withSources = (sources: IntentData["sources"]) => {
    state.data = { ...INTENT, sources };
    renderBlock();
  };

  it("explains an unavailable plan or ticket as not found at the PR head commit", () => {
    withSources([
      { label: "Plan at docs/architecture.md", status: "unavailable" },
      { label: "Linked issue #482", status: "unavailable" },
    ]);
    const reasons = screen.getAllByTestId("source-reason");
    expect(reasons).toHaveLength(2);
    for (const r of reasons) expect(r).toHaveTextContent(brief.intent.reasonNotFound);
  });

  it("explains a cross-repository reference as not fetched", () => {
    withSources([{ label: "Issue a/b#9 (other repository)", status: "unavailable" }]);
    expect(screen.getByTestId("source-reason")).toHaveTextContent(brief.intent.reasonOtherRepo);
  });

  it("explains a failed fetch as an error with the likely causes", () => {
    withSources([{ label: "Plan at docs/plan.md", status: "error" }]);
    expect(screen.getByTestId("source-reason")).toHaveTextContent(brief.intent.reasonError);
  });

  it("shows no reason for a fetched source", () => {
    withSources([{ label: "PR body", status: "fetched" }]);
    expect(screen.queryByTestId("source-reason")).toBeNull();
  });

  it("keeps the reason inside the same chip as its label", () => {
    withSources([{ label: "Plan at docs/architecture.md", status: "unavailable" }]);
    const chip = screen.getByText("Plan at docs/architecture.md").parentElement!;
    expect(chip).toContainElement(screen.getByTestId("source-reason"));
  });

  it("renders the summary as a quote and exactly one button (Recalculate)", () => {
    state.data = INTENT;
    renderBlock();
    expect(screen.getByText("Add intent layer").textContent).toBe("“Add intent layer”");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Recalculate" })).toBeInTheDocument();
  });

  it("empty state matches the design: title, hint and a Run Intent button", () => {
    state.error = new ApiError("404 Not Found", 404);
    renderBlock();
    expect(screen.getByText("Intent not yet analysed")).toBeInTheDocument();
    expect(
      screen.getByText("Run review agents to analyse the intent and scope of this pull request."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run Intent" })).toBeInTheDocument();
  });

  const finding = (id: string, scope: string | null, dismissed = false) => ({
    id,
    severity: "WARNING",
    category: "bug",
    title: id,
    file: "a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    confidence: 0.9,
    scope,
    accepted_at: null,
    dismissed_at: dismissed ? "2026-01-02T00:00:00Z" : null,
  });
  const review = (findings: unknown[]) => ({
    id: "r1",
    pr_id: "pr1",
    agent_id: "A",
    kind: "review",
    created_at: "2026-01-01T00:00:00Z",
    findings,
  });

  it("shows how many findings were hidden as out of scope, with a link to the Findings tab", () => {
    state.data = INTENT;
    state.reviews = [review([finding("a", "out"), finding("b", "out"), finding("c", "in")])];
    renderBlock();
    const line = screen.getByTestId("intent-hidden-findings");
    expect(line.textContent).toContain("2 findings hidden as out of scope");
    expect(screen.getByRole("link", { name: "View in Findings" })).toHaveAttribute("href", "?tab=findings");
  });

  it("uses the singular for one hidden finding; dismissed and in-scope ones are not counted", () => {
    state.data = INTENT;
    state.reviews = [review([finding("a", "out"), finding("d", "out", true), finding("s", "signal")])];
    renderBlock();
    expect(screen.getByTestId("intent-hidden-findings").textContent).toContain("1 finding hidden as out of scope");
  });

  it("shows nothing about hidden findings when none are hidden", () => {
    state.data = INTENT;
    state.reviews = [review([finding("a", "in"), finding("b", null)])];
    renderBlock();
    expect(screen.queryByTestId("intent-hidden-findings")).not.toBeInTheDocument();
  });
});
