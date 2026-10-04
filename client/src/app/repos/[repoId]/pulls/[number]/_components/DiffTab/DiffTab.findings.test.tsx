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

const goSmart = () => fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
const expandAll = (i = 0) =>
  fireEvent.click(within(screen.getAllByTestId("smart-diff-group")[i]!).getByTestId("group-toggle-files"));
const sev = (id: string, severity: string, file: string, line: number): FindingRecord => ({
  ...fi(id, file, line),
  severity: severity as FindingRecord["severity"],
});

describe("DiffTab findings", () => {
  it("group header sums FINDINGS by severity (more findings than files is fine)", () => {
    state.smart = SMART;
    state.reviews = [
      review([
        fi("1", "src/a.ts", 2),
        fi("2", "src/a.ts", 2),
        fi("3", "src/a.ts", 1),
        sev("4", "WARNING", "src/b.ts", 2),
      ]),
    ];
    renderTab();
    goSmart();
    const groups = screen.getAllByTestId("smart-diff-group");
    const badges = within(groups[0]!).getAllByTestId("group-findings-dot");
    expect(badges.map((b) => [b.getAttribute("data-severity"), b.textContent])).toEqual([
      ["CRITICAL", "3"],
      ["WARNING", "1"],
    ]);
    expect(badges[0]).toHaveAttribute("aria-label", "3 findings");
    expect(badges[1]).toHaveAttribute("aria-label", "1 finding");
    // tests group has no findings -> no badge
    expect(within(groups[1]!).queryByTestId("group-findings-dot")).not.toBeInTheDocument();
  });

  it("group badges and file dots come from the reviews, not from finding_lines", () => {
    // SMART carries finding_lines [2] for src/a.ts, but no review has findings
    state.smart = SMART;
    state.reviews = [review([])];
    renderTab();
    goSmart();
    expect(screen.queryByTestId("group-findings-dot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-findings-dot")).not.toBeInTheDocument();
  });

  it("dismissing a finding updates the group badge and the file dot together", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2)])];
    const view = renderTab();
    goSmart();
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

  it("an accepted finding stays visible: dot and badge remain", () => {
    state.smart = SMART;
    state.reviews = [review([{ ...fi("1", "src/a.ts", 2), accepted_at: "2026-01-02T00:00:00Z" }])];
    renderTab();
    goSmart();
    expect(screen.getByTestId("group-findings-dot").textContent).toBe("1");
    expect(screen.getAllByTestId("file-findings-dot")).toHaveLength(1);
  });

  it("file header shows the dot plus an icon + count per blocker / warning", () => {
    state.smart = SMART;
    state.reviews = [
      review([fi("1", "src/a.ts", 2), fi("2", "src/a.ts", 1), sev("3", "WARNING", "src/a.ts", 2)]),
    ];
    renderTab();
    expect(screen.getAllByTestId("file-findings-dot")).toHaveLength(1);
    const chips = screen.getAllByTestId("file-findings-count");
    expect(chips.map((c) => [c.getAttribute("data-severity"), c.textContent])).toEqual([
      ["CRITICAL", "2"],
      ["WARNING", "1"],
    ]);
  });

  it("renders inline finding cards in grouped mode once the files are expanded", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2)])];
    renderTab();
    goSmart();
    expect(screen.getAllByTestId("file-findings-dot")).toHaveLength(1);
    expect(screen.queryByText("title-1")).not.toBeInTheDocument(); // file rows start collapsed
    expandAll(0);
    expect(screen.getByText("title-1")).toBeInTheDocument();
  });

  it("the finding card shows category, location, confidence, rationale and the suggested fix", () => {
    state.reviews = [review([{ ...fi("1", "src/a.ts", 2), suggestion: "do-this-instead" }])];
    renderTab();
    expect(screen.getByTestId("smart-finding-category").textContent).toBe("bug");
    expect(screen.getByTestId("smart-finding-meta").textContent).toContain("src/a.ts:2");
    expect(screen.getByTestId("smart-finding-meta").textContent).toContain("90% conf");
    expect(screen.getByText("why-1")).toBeInTheDocument();
    expect(screen.getByText("Suggested fix")).toBeInTheDocument();
    expect(screen.getByText("do-this-instead")).toBeInTheDocument();
  });

  it("renders file dots and cards in the default Original order, without group badges", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2)])];
    renderTab();
    expect(screen.queryByTestId("group-findings-dot")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("file-findings-dot")).toHaveLength(1);
    expect(screen.getByText("title-1")).toBeInTheDocument();
  });

  it("works while smart-diff is unavailable (flat list, findings from reviews)", () => {
    state.reviews = [review([fi("1", "src/a.ts", 2)])];
    renderTab();
    expect(screen.getByText("title-1")).toBeInTheDocument();
  });

  it("Hide/Show findings only touches finding cards; dots and badges stay, github comments stay", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2), fi("far", "src/a.ts", 900)])];
    state.comments = [ghComment(1, "src/a.ts", 2)];
    renderTab();
    expect(screen.getByText("title-1")).toBeInTheDocument();
    expect(screen.getByTestId("unmatched-findings")).toBeInTheDocument();
    expect(screen.getByText("gh-body-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide findings (2)" }));
    expect(screen.queryByText("title-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("unmatched-findings")).not.toBeInTheDocument();
    expect(screen.getByText("gh-body-1")).toBeInTheDocument();
    expect(screen.getByTestId("file-findings-dot")).toBeInTheDocument();
    goSmart();
    expect(screen.getByTestId("group-findings-dot")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show findings (2)" }));
    expandAll(0);
    expect(screen.getByText("title-1")).toBeInTheDocument();
  });

  it("Hide/Show comments is a separate button, only present with github comments", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2)])];
    state.comments = [ghComment(1, "src/a.ts", 2)];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Hide comments (1)" }));
    expect(screen.queryByText("gh-body-1")).not.toBeInTheDocument();
    expect(screen.getByText("title-1")).toBeInTheDocument(); // findings unaffected
    fireEvent.click(screen.getByRole("button", { name: "Show comments (1)" }));
    expect(screen.getByText("gh-body-1")).toBeInTheDocument();
  });

  it("findings button counts findings only (not github comments)", () => {
    state.smart = SMART;
    state.reviews = [review([fi("1", "src/a.ts", 2), fi("2", "src/b.ts", 2)])];
    state.comments = [ghComment(1, "src/a.ts", 2), ghComment(2, "src/a.ts", 2), ghComment(3, "src/a.ts", 2)];
    renderTab();
    expect(screen.getByRole("button", { name: "Hide findings (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide comments (3)" })).toBeInTheDocument();
  });

  it("findings on files that are not in the PR do not inflate the count or show the button", () => {
    state.smart = SMART;
    state.reviews = [review([fi("ghost", "src/not-in-pr.ts", 1)])];
    renderTab();
    expect(screen.queryByRole("button", { name: /(hide|show) findings/i })).not.toBeInTheDocument();

    cleanup();
    state.reviews = [review([fi("1", "src/a.ts", 2), fi("ghost", "src/not-in-pr.ts", 1)])];
    renderTab();
    expect(screen.getByRole("button", { name: "Hide findings (1)" })).toBeInTheDocument();
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
    state.comments = [ghComment(1, "src/a.ts", 2)];
    state.createMutate.mockResolvedValue({});
    renderTab(true);
    fireEvent.click(screen.getByRole("button", { name: /^Hide comments/ }));
    expect(screen.queryByText("gh-body-1")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getAllByText("body of src/a.ts")[0]!.parentElement!.parentElement!);
    fireEvent.click(screen.getByRole("button", { name: "Add a comment on this line" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(state.createMutate).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /^Hide comments/ })).toBeInTheDocument();
  });

  it("buttons are hidden when there are neither comments nor findings", () => {
    state.smart = SMART;
    renderTab();
    expect(screen.queryByRole("button", { name: /(hide|show) (comments|findings)/i })).not.toBeInTheDocument();
  });

  it("tells the user the review has not run yet, until a review exists", () => {
    state.smart = SMART;
    renderTab();
    expect(screen.getByTestId("review-not-run").textContent).toBe(prReview.smartDiff.reviewNotRun);
    cleanup();
    state.reviews = [review([])];
    renderTab();
    expect(screen.queryByTestId("review-not-run")).not.toBeInTheDocument();
  });
});

describe("DiffTab scope", () => {
  const sc = (id: string, file: string, line: number, scope: FindingRecord["scope"], reason?: string): FindingRecord => ({
    ...fi(id, file, line),
    scope,
    scope_reason: reason ?? null,
  });

  it("out findings produce no inline card, dot, group badge, or Hide-findings count", () => {
    state.smart = SMART;
    state.reviews = [review([sc("o1", "src/a.ts", 2, "out"), sc("o2", "src/b.ts", 2, "out")])];
    renderTab();
    goSmart();
    expect(screen.queryByText("title-o1")).not.toBeInTheDocument();
    expect(screen.queryByText("title-o2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-findings-dot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("group-findings-dot")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /(hide|show) findings/i })).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Hide findings (2)" })).toBeInTheDocument();
    goSmart();
    expect(screen.getByTestId("group-findings-dot").textContent).toBe("2");
    expect(screen.getAllByTestId("file-findings-dot")).toHaveLength(1);
  });

  it("signal counts and renders inline with the marker and plain-text reason", () => {
    state.smart = SMART;
    state.reviews = [review([sc("s", "src/b.ts", 2, "signal", "Uses <b>x</b> and **md**")])];
    renderTab();
    expect(screen.getByRole("button", { name: "Hide findings (1)" })).toBeInTheDocument();
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
    expect(screen.getAllByRole("button", { name: /(hide|show) findings/i })).toHaveLength(1);
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

  it("the hint stays when findings are hidden, and out findings on files outside the PR are not counted", () => {
    state.smart = SMART;
    state.reviews = [review([sc("i", "src/a.ts", 2, "in"), sc("o", "src/b.ts", 2, "out"), sc("g", "src/ghost.ts", 1, "out")])];
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /^Hide findings/ }));
    expect(screen.getByTestId("out-of-scope-hint").textContent).toMatch(/^1 out-of-scope finding hidden$/);
  });
});
