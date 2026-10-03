import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, PrReviewComment, ReviewRecord, SmartDiff } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

const state: {
  smart: SmartDiff | undefined;
  reviews: ReviewRecord[];
  comments: PrReviewComment[];
  createMutate: ReturnType<typeof vi.fn>;
} = {
  smart: undefined,
  reviews: [],
  comments: [],
  createMutate: vi.fn(),
};

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: state.comments }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: state.createMutate }),
  usePrReviews: () => ({ data: state.reviews }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/smart-diff", () => ({
  useSmartDiff: () => ({ data: state.smart, isError: false }),
}));

import { DiffTab } from "./DiffTab";

beforeEach(() => {
  state.smart = undefined;
  state.reviews = [];
  state.comments = [];
  state.createMutate = vi.fn();
});
afterEach(cleanup);

const pf = (path: string): PrFile => ({
  path,
  additions: 2,
  deletions: 0,
  patch: `@@ -1,1 +1,2 @@\n keep\n+body of ${path}`,
});
// new lines: 1 (ctx), 2 (add)
const FILES = [pf("src/a.ts"), pf("src/b.ts"), pf("src/a.test.ts")];

const sf = (path: string, lines: number[]) => ({
  path,
  additions: 2,
  deletions: 0,
  finding_lines: lines,
});
const SMART: SmartDiff = {
  groups: [
    { role: "core", files: [sf("src/a.ts", [2]), sf("src/b.ts", [])] },
    { role: "tests", files: [sf("src/a.test.ts", [])] },
  ],
  split_suggestion: { too_big: false, total_lines: 6, proposed_splits: [] },
};

const fi = (id: string, file: string, line: number): FindingRecord => ({
  id,
  severity: "CRITICAL",
  category: "bug",
  title: `title-${id}`,
  file,
  start_line: line,
  end_line: line,
  rationale: `why-${id}`,
  confidence: 0.9,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
});

const review = (findings: FindingRecord[]): ReviewRecord => ({
  id: "r1",
  pr_id: "pr1",
  agent_id: "A",
  run_id: null,
  kind: "review",
  verdict: null,
  summary: null,
  score: null,
  model: null,
  created_at: "2026-01-01T00:00:00Z",
  findings,
});

const ghComment = (id: number, path: string, line: number): PrReviewComment => ({
  id,
  path,
  line,
  original_line: line,
  side: "RIGHT",
  body: `gh-body-${id}`,
  user: "octocat",
  created_at: "2026-01-01T00:00:00Z",
  html_url: "https://github.com/x/y/pull/1#c",
  in_reply_to_id: null,
  is_outdated: false,
});

function renderTab(canComment = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffTab prId="pr1" filesCount={FILES.length} files={FILES} canComment={canComment} />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab findings", () => {
  it("group header shows the number of FILES with findings (3 findings in one file count once)", () => {
    state.smart = SMART;
    state.reviews = [
      review([fi("1", "src/a.ts", 2), fi("2", "src/a.ts", 2), fi("3", "src/a.ts", 1)]),
    ];
    renderTab();
    const headers = screen.getAllByTestId("smart-diff-group-header");
    const dot = within(headers[0]!).getByTestId("group-findings-dot");
    expect(dot.textContent).toBe("1");
    expect(dot).toHaveAttribute("aria-label", "1 file with findings");
    // dot comes before the "N files" label
    expect(headers[0]!.textContent).toMatch(/Core.*1.*2 files$/);
    expect(within(headers[0]!).getByText(/^2 files$/)).toBeInTheDocument();
    expect(within(headers[1]!).getByText(/^1 file$/)).toBeInTheDocument();
    // tests group has no findings -> no dot
    expect(within(headers[1]!).queryByTestId("group-findings-dot")).not.toBeInTheDocument();
  });

  it("group counter and file dot both come from the reviews, not from finding_lines", () => {
    // SMART carries finding_lines [2] for src/a.ts, but no review has findings
    state.smart = SMART;
    state.reviews = [review([])];
    renderTab();
    expect(screen.queryByTestId("group-findings-dot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-findings-dot")).not.toBeInTheDocument();
  });

  it("dismissing a finding updates the group counter and the file dot together", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2)])];
    const view = renderTab();
    expect(screen.getByTestId("group-findings-dot").textContent).toBe("1");
    expect(screen.getAllByTestId("file-findings-dot")).toHaveLength(1);

    // refetched reviews after useFindingAction invalidated ["reviews", prId]
    state.reviews = [review([{ ...fi("1", "src/a.ts", 2), dismissed_at: "2026-01-02T00:00:00Z" }])];
    view.rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
        <DiffTab prId="pr1" filesCount={FILES.length} files={FILES} canComment={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByTestId("group-findings-dot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-findings-dot")).not.toBeInTheDocument();
  });

  it("an accepted finding stays visible: dot and counter remain", () => {
    state.smart = SMART;
    state.reviews = [
      review([{ ...fi("1", "src/a.ts", 2), accepted_at: "2026-01-02T00:00:00Z" }]),
    ];
    renderTab();
    expect(screen.getByTestId("group-findings-dot").textContent).toBe("1");
    expect(screen.getAllByTestId("file-findings-dot")).toHaveLength(1);
  });

  it("shows no group dot when there are no findings", () => {
    state.smart = { ...SMART, groups: SMART.groups.map((g) => ({ ...g, files: g.files.map((f) => ({ ...f, finding_lines: [] })) })) };
    renderTab();
    expect(screen.queryByTestId("group-findings-dot")).not.toBeInTheDocument();
  });

  it("renders file dots and inline finding cards in grouped mode", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2)])];
    renderTab();
    expect(screen.getAllByTestId("file-findings-dot")).toHaveLength(1);
    expect(screen.getByText("title-1")).toBeInTheDocument();
  });

  it("renders file dots and cards in Original order, without header counters", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2)])];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(screen.queryByTestId("group-findings-dot")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("file-findings-dot")).toHaveLength(1);
    expect(screen.getByText("title-1")).toBeInTheDocument();
  });

  it("works while smart-diff is unavailable (flat list, findings from reviews)", () => {
    state.reviews = [review([fi("1", "src/a.ts", 2)])];
    renderTab();
    expect(screen.getByText("title-1")).toBeInTheDocument();
  });

  it("one button hides and shows BOTH github comments and finding cards; dots and counters stay", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2), fi("far", "src/a.ts", 900)])];
    state.comments = [ghComment(1, "src/a.ts", 2)];
    renderTab();
    // default: both shown
    expect(screen.getByText("title-1")).toBeInTheDocument();
    expect(screen.getByTestId("unmatched-findings")).toBeInTheDocument();
    expect(screen.getByText("gh-body-1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /(hide|show) comments/i })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /(hide|show) findings/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Hide comments/ }));
    expect(screen.queryByText("title-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("unmatched-findings")).not.toBeInTheDocument();
    expect(screen.queryByText("gh-body-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-findings-dot")).toBeInTheDocument();
    expect(screen.getByTestId("group-findings-dot")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Show comments/ }));
    expect(screen.getByText("title-1")).toBeInTheDocument();
    expect(screen.getByText("gh-body-1")).toBeInTheDocument();
  });

  it("toggle is visible with findings only, shows the count and actually hides the finding card", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2)])];
    renderTab();
    expect(screen.getByRole("button", { name: "Hide comments (1)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide comments (1)" }));
    expect(screen.queryByText("title-1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show comments (1)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show comments (1)" }));
    expect(screen.getByText("title-1")).toBeInTheDocument();
  });

  it("count is github comments + findings", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2), fi("2", "src/b.ts", 2)])];
    state.comments = [ghComment(1, "src/a.ts", 2), ghComment(2, "src/a.ts", 2), ghComment(3, "src/a.ts", 2)];
    renderTab();
    expect(screen.getByRole("button", { name: "Hide comments (5)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide comments (5)" }));
    expect(screen.getByRole("button", { name: "Show comments (5)" })).toBeInTheDocument();
  });

  it("findings on files that are not in the PR do not inflate the count or show the button", () => {
    state.smart = SMART;
    state.reviews = [review([fi("ghost", "src/not-in-pr.ts", 1)])];
    renderTab();
    expect(screen.queryByRole("button", { name: /(hide|show) comments/i })).not.toBeInTheDocument();

    cleanup();
    state.reviews = [review([fi("1", "src/a.ts", 2), fi("ghost", "src/not-in-pr.ts", 1)])];
    renderTab();
    expect(screen.getByRole("button", { name: "Hide comments (1)" })).toBeInTheDocument();
  });

  it("hides outdated github comments too", () => {
    state.smart = SMART;
    state.comments = [ghComment(1, "src/a.ts", 900)]; // line not in the diff -> outdated bucket
    renderTab();
    expect(screen.getByText("gh-body-1")).toBeInTheDocument();
    expect(screen.getByText(/1 comment\(s\) on older revisions/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide comments (1)" }));
    expect(screen.queryByText("gh-body-1")).not.toBeInTheDocument();
    expect(screen.queryByText(/on older revisions/)).not.toBeInTheDocument();
  });

  it("posting a comment re-shows comments that were hidden", async () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2)])];
    state.createMutate.mockResolvedValue({});
    renderTab(true);
    fireEvent.click(screen.getByRole("button", { name: /^Hide comments/ }));
    expect(screen.queryByText("title-1")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getAllByText("body of src/a.ts")[0]!.parentElement!.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: "Add a comment on this line" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(state.createMutate).toHaveBeenCalled());
    expect(await screen.findByText("title-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Hide comments/ })).toBeInTheDocument();
  });

  it("toggle is visible with github comments only", () => {
    state.smart = SMART;
    state.comments = [ghComment(1, "src/a.ts", 2)];
    renderTab();
    expect(screen.getByRole("button", { name: /^Hide comments/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Hide comments/ }));
    expect(screen.queryByText("gh-body-1")).not.toBeInTheDocument();
  });

  it("toggle is hidden when there are neither comments nor findings", () => {
    state.smart = SMART;
    renderTab();
    expect(screen.queryByRole("button", { name: /(hide|show) comments/i })).not.toBeInTheDocument();
  });
});

describe("DiffTab scope", () => {
  const sc = (id: string, file: string, line: number, scope: FindingRecord["scope"], reason?: string): FindingRecord => ({
    ...fi(id, file, line),
    scope,
    scope_reason: reason ?? null,
  });

  it("out findings produce no inline card, dot, group counter, or Hide-comments count", () => {
    state.smart = SMART;
    state.reviews = [review([sc("o1", "src/a.ts", 2, "out"), sc("o2", "src/b.ts", 2, "out")])];
    renderTab();
    expect(screen.queryByText("title-o1")).not.toBeInTheDocument();
    expect(screen.queryByText("title-o2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-findings-dot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("group-findings-dot")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /(hide|show) comments/i })).not.toBeInTheDocument();
  });

  it("out findings are not counted next to in-scope ones; legacy null and in count", () => {
    state.smart = SMART;
    state.reviews = [
      review([
        sc("i", "src/a.ts", 2, "in"),
        sc("l", "src/a.ts", 1, null),
        sc("o", "src/b.ts", 2, "out"),
      ]),
    ];
    renderTab();
    expect(screen.getByRole("button", { name: "Hide comments (2)" })).toBeInTheDocument();
    expect(screen.getByTestId("group-findings-dot").textContent).toBe("1");
    expect(screen.getAllByTestId("file-findings-dot")).toHaveLength(1);
  });

  it("signal counts and renders inline with the marker and plain-text reason", () => {
    state.smart = SMART;
    state.reviews = [review([sc("s", "src/b.ts", 2, "signal", "Uses <b>x</b> and **md**")])];
    renderTab();
    expect(screen.getByRole("button", { name: "Hide comments (1)" })).toBeInTheDocument();
    expect(screen.getAllByTestId("file-findings-dot")).toHaveLength(1);
    expect(screen.getByText("title-s")).toBeInTheDocument();
    expect(screen.getByText("Out of scope · serious")).toBeInTheDocument();
    const reason = screen.getByTestId("finding-scope-reason");
    expect(reason.textContent).toBe("Uses <b>x</b> and **md**");
    expect(reason.querySelector("b, strong")).toBeNull();
  });

  it("shows a passive hint with the singular for exactly 1 hidden finding", () => {
    state.smart = SMART;
    state.reviews = [review([sc("i", "src/a.ts", 2, "in"), sc("o", "src/b.ts", 2, "out")])];
    renderTab();
    expect(screen.getByTestId("out-of-scope-hint").textContent).toMatch(
      /^1 out-of-scope finding hidden$/,
    );
    // still a single toggle, no second one
    expect(screen.getAllByRole("button", { name: /(hide|show) comments/i })).toHaveLength(1);
  });

  it("shows the plural hint for several hidden findings and no hint for zero", () => {
    state.smart = SMART;
    state.reviews = [
      review([sc("o1", "src/a.ts", 2, "out"), sc("o2", "src/a.ts", 1, "out"), sc("o3", "src/b.ts", 2, "out")]),
    ];
    renderTab();
    expect(screen.getByTestId("out-of-scope-hint").textContent).toMatch(
      /^3 out-of-scope findings hidden$/,
    );

    cleanup();
    state.reviews = [review([sc("i", "src/a.ts", 2, "in")])];
    renderTab();
    expect(screen.queryByTestId("out-of-scope-hint")).not.toBeInTheDocument();
  });

  it("the hint stays when comments are hidden, and out findings on files outside the PR are not counted", () => {
    state.smart = SMART;
    state.reviews = [review([sc("i", "src/a.ts", 2, "in"), sc("o", "src/b.ts", 2, "out"), sc("g", "src/ghost.ts", 1, "out")])];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /^Hide comments/ }));
    expect(screen.getByTestId("out-of-scope-hint").textContent).toMatch(/^1 out-of-scope finding hidden$/);
  });
});
