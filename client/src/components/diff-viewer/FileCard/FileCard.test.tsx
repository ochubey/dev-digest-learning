import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import prReview from "../../../../messages/en/prReview.json";
import shell from "../../../../messages/en/shell.json";

vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FileCard } from "./FileCard";
import type { DiffCommentApi } from "../comments";
import type { DiffFindingsApi } from "../findings";

afterEach(cleanup);

// new lines: 10 (ctx), 11 (add), 12 (add)
const FILE: PrFile = {
  path: "src/a.ts",
  additions: 2,
  deletions: 0,
  patch: "@@ -10,1 +10,3 @@\n keep\n+added eleven\n+added twelve",
};

const fi = (id: string, line: number, over: Partial<FindingRecord> = {}): FindingRecord => ({
  id,
  severity: "WARNING",
  category: "bug",
  title: `title-${id}`,
  file: "src/a.ts",
  start_line: line,
  end_line: line,
  rationale: `why-${id}`,
  confidence: 0.9,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
  ...over,
});

const api = (items: FindingRecord[], show = true): DiffFindingsApi => ({
  items,
  show,
  prId: "pr1",
});

function renderCard(props: {
  findings?: DiffFindingsApi;
  commenting?: DiffCommentApi;
  file?: PrFile;
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <FileCard file={props.file ?? FILE} defaultOpen {...props} />
    </NextIntlClientProvider>,
  );
}

const ghComment = (id: number) => ({
  id,
  path: "src/a.ts",
  line: 11,
  side: "RIGHT" as const,
  body: "gh",
  user: "u",
  created_at: "2026-01-01T00:00:00Z",
  in_reply_to_id: null,
});

describe("FileCard findings dot", () => {
  it("shows a dot without a number when the file has findings", () => {
    renderCard({ findings: api([fi("a", 11), fi("b", 12), fi("c", 12)]) });
    const dot = screen.getByTestId("file-findings-dot");
    expect(dot).toHaveAttribute("aria-label", "Has findings");
    expect(dot.textContent).toBe("");
  });

  it("has no dot when the file has no findings (other file's findings ignored)", () => {
    renderCard({ findings: api([fi("x", 11, { file: "other.ts" })]) });
    expect(screen.queryByTestId("file-findings-dot")).not.toBeInTheDocument();
  });

  it("uses the colour of the highest severity", () => {
    renderCard({
      findings: api([fi("a", 11, { severity: "SUGGESTION" }), fi("b", 12, { severity: "CRITICAL" })]),
    });
    expect(screen.getByTestId("file-findings-dot").style.background).toContain("var(--crit)");
  });

  it("leaves the GitHub comment counter unaffected", () => {
    const commenting: DiffCommentApi = {
      comments: [ghComment(1), ghComment(2)],
      canComment: false,
      showComments: false,
      posting: false,
      onSubmit: vi.fn(),
    } as unknown as DiffCommentApi;
    renderCard({ commenting, findings: api([fi("a", 11), fi("b", 12), fi("c", 12)]) });
    expect(screen.getByTestId("file-comment-count").textContent).toBe("2");
    expect(screen.getByTestId("file-findings-dot").textContent).toBe("");
  });
});

describe("FileCard inline findings", () => {
  it("renders the finding directly under the line with new_line == start_line only", () => {
    renderCard({ findings: api([fi("a", 11)]) });
    const card = screen.getByTestId("smart-finding-card");
    const row = screen.getByText("added eleven").closest("div")!.parentElement!;
    expect(row).toContainElement(card);
    for (const other of ["keep", "added twelve"]) {
      const o = screen.getByText(other).closest("div")!.parentElement!;
      expect(o).not.toContainElement(card);
    }
    expect(screen.queryByTestId("unmatched-findings")).not.toBeInTheDocument();
  });

  it("puts a finding whose line is not in the patch into the block at the end", () => {
    renderCard({ findings: api([fi("far", 500)]) });
    const block = screen.getByTestId("unmatched-findings");
    expect(within(block).getByText("Findings outside the diff")).toBeInTheDocument();
    expect(within(block).getByText("title-far")).toBeInTheDocument();
    const body = block.parentElement!;
    expect(body.lastElementChild).toBe(block);
  });

  it("puts findings of a file without a patch into the unmatched block", () => {
    renderCard({
      file: { path: "src/a.ts", additions: 0, deletions: 0, patch: null } as unknown as PrFile,
      findings: api([fi("np", 1)]),
    });
    expect(screen.getByTestId("unmatched-findings")).toBeInTheDocument();
    expect(screen.getByTestId("file-findings-dot")).toBeInTheDocument();
  });

  it("hides cards and the unmatched block but keeps the dot when show is false", () => {
    renderCard({ findings: api([fi("a", 11), fi("far", 500)], false) });
    expect(screen.queryByTestId("smart-finding-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("unmatched-findings")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-findings-dot")).toBeInTheDocument();
  });
});
