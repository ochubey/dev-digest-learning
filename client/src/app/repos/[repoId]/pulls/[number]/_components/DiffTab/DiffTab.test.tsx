import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";

const smartDiffState: { data: SmartDiff | undefined; isError: boolean } = {
  data: undefined,
  isError: false,
};

vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
  usePrReviews: () => ({ data: [] }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/smart-diff", () => ({
  useSmartDiff: () => smartDiffState,
}));

import { DiffTab } from "./DiffTab";

beforeEach(() => {
  smartDiffState.data = undefined;
  smartDiffState.isError = false;
});
afterEach(cleanup);

const pf = (path: string, body: string): PrFile => ({
  path,
  additions: 1,
  deletions: 0,
  patch: `@@ -1,1 +1,1 @@\n+${body}`,
});
const sf = (path: string) => ({ path, additions: 1, deletions: 0, finding_lines: [] });

const FILES = [
  pf("README.md", "docbody"),
  pf("src/a.ts", "corebody"),
  pf("src/a.test.ts", "testbody"),
  pf("pnpm-lock.yaml", "lockbody"),
];

const SMART: SmartDiff = {
  groups: [
    { role: "core", files: [sf("src/a.ts")] },
    { role: "tests", files: [sf("src/a.test.ts")] },
    { role: "docs", files: [sf("README.md")] },
    { role: "boilerplate", files: [sf("pnpm-lock.yaml")] },
  ],
  split_suggestion: { too_big: false, total_lines: 4, proposed_splits: [] },
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffTab prId="pr1" filesCount={FILES.length} files={FILES} canComment={false} />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab smart-diff groups", () => {
  it("shows group headers with label and file count in fixed order", () => {
    smartDiffState.data = SMART;
    renderTab();
    const headers = screen.getAllByTestId("smart-diff-group-header");
    expect(headers[0]!.textContent).toContain("Core");
    expect(headers[1]!.textContent).toContain("Tests");
    expect(headers[2]!.textContent).toContain("Docs");
    expect(headers[3]!.textContent).toContain("Boilerplate");
    // exact: "1 files" must fail
    expect(within(headers[0]!).getByText(/^1 file$/)).toBeInTheDocument();
    expect(within(headers[0]!).queryByText(/1 files/)).not.toBeInTheDocument();
  });

  it("header uses the singular for one file and the plural otherwise", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
        <DiffTab prId="pr1" filesCount={1} files={[FILES[0]!]} canComment={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/^Files changed · 1 file$/)).toBeInTheDocument();
    unmount();
    renderTab();
    expect(screen.getByText(/^Files changed · 4 files$/)).toBeInTheDocument();
  });

  it("renders all five groups together in server order with their labels", () => {
    const five: SmartDiff = {
      ...SMART,
      groups: [
        { role: "core", files: [sf("src/a.ts")] },
        { role: "tests", files: [sf("src/a.test.ts")] },
        { role: "wiring", files: [sf("src/index.ts"), sf("src/routes.ts")] },
        { role: "docs", files: [sf("README.md")] },
        { role: "boilerplate", files: [sf("pnpm-lock.yaml")] },
      ],
    };
    smartDiffState.data = five;
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
        <DiffTab
          prId="pr1"
          filesCount={6}
          files={[...FILES, pf("src/index.ts", "idx"), pf("src/routes.ts", "rt")]}
          canComment={false}
        />
      </NextIntlClientProvider>,
    );
    const roles = screen.getAllByTestId("smart-diff-group").map((g) => g.getAttribute("data-role"));
    expect(roles).toEqual(["core", "tests", "wiring", "docs", "boilerplate"]);
    const headers = screen.getAllByTestId("smart-diff-group-header").map((h) => h.textContent ?? "");
    const labels = ["Core", "Tests", "Wiring", "Docs", "Boilerplate"];
    const counts = ["1 file", "1 file", "2 files", "1 file", "1 file"];
    labels.forEach((label, i) => {
      expect(headers[i]).toContain(label);
      // exact count text at the end of the header (so "1 files" / "11 file" fail)
      expect(headers[i]!.endsWith(counts[i]!)).toBe(true);
      expect(headers[i]).not.toMatch(/1 files/);
    });
  });

  it("preserves the server group order (a shuffled response keeps its order)", () => {
    smartDiffState.data = { ...SMART, groups: [...SMART.groups].reverse() };
    renderTab();
    const roles = screen.getAllByTestId("smart-diff-group").map((g) => g.getAttribute("data-role"));
    expect(roles).toEqual(["boilerplate", "docs", "tests", "core"]);
  });

  it("collapses docs and boilerplate by default and expands on click with cards following the auto-expand rule", () => {
    smartDiffState.data = SMART;
    renderTab();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("corebody")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Docs"));
    expect(screen.getByText("README.md")).toBeInTheDocument();
    // small file card inside an expanded docs group follows AUTO_EXPAND_MAX_LINES
    expect(screen.getByText("docbody")).toBeInTheDocument();
  });

  it("Original order toggle removes group headers and renders GitHub order", () => {
    smartDiffState.data = SMART;
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    expect(screen.queryByTestId("smart-diff-group-header")).not.toBeInTheDocument();
    const paths = screen.getAllByText(/\.(md|ts|yaml)$/).map((e) => e.textContent);
    expect(paths).toEqual(["README.md", "src/a.ts", "src/a.test.ts", "pnpm-lock.yaml"]);
  });

  it("falls back to the flat list while smart-diff is loading", () => {
    renderTab();
    expect(screen.queryByTestId("smart-diff-group-header")).not.toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.queryByTestId("grouping-unavailable")).not.toBeInTheDocument();
  });

  it("falls back to the flat list with a visible message when smart-diff failed", () => {
    smartDiffState.isError = true;
    renderTab();
    expect(screen.queryByTestId("smart-diff-group-header")).not.toBeInTheDocument();
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
    const paths = screen.getAllByText(/\.(md|ts|yaml)$/).map((e) => e.textContent);
    expect(paths).toEqual(["README.md", "src/a.ts", "src/a.test.ts", "pnpm-lock.yaml"]);
    expect(screen.getByTestId("grouping-unavailable").textContent).toBe(
      prReview.smartDiff.groupingUnavailable,
    );
  });
});
