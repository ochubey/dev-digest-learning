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

const goSmart = () => fireEvent.click(screen.getByRole("button", { name: "Smart order" }));

describe("DiffTab smart-diff groups", () => {
  it("defaults to Original order (flat list, no group headers) and Smart order switches to groups", () => {
    smartDiffState.data = SMART;
    renderTab();
    expect(screen.queryByTestId("smart-diff-group-header")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Original order" })).toHaveAttribute("aria-pressed", "true");
    goSmart();
    expect(screen.getAllByTestId("smart-diff-group-header").length).toBe(5);
    expect(screen.getByRole("button", { name: "Smart order" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows all five roles in fixed order with label, description, colour and file count; empty ones are disabled", () => {
    smartDiffState.data = SMART;
    renderTab();
    goSmart();
    const groups = screen.getAllByTestId("smart-diff-group");
    expect(groups.map((g) => g.getAttribute("data-role"))).toEqual(["core", "tests", "wiring", "docs", "boilerplate"]);
    const header = (i: number) => within(groups[i]!).getByTestId("smart-diff-group-header");
    expect(header(0).textContent).toContain("Core logic");
    expect(header(0).textContent).toContain("The substance of the change");
    expect(header(1).textContent).toContain("Tests");
    expect(header(2).textContent).toContain("Wiring");
    expect(header(3).textContent).toContain("Docs");
    expect(header(4).textContent).toContain("Boilerplate");
    expect(within(groups[0]!).getByTestId("group-color")).toBeInTheDocument();
    // exact: "1 files" must fail
    expect(within(groups[0]!).getByText(/^1 file$/)).toBeInTheDocument();
    expect(within(groups[0]!).queryByText(/1 files/)).not.toBeInTheDocument();
    // wiring has no files in SMART: shown as "0 files", header disabled, no expand-all button
    expect(within(groups[2]!).getByText("0 files")).toBeInTheDocument();
    expect(header(2)).toBeDisabled();
    expect(groups[2]).toHaveAttribute("data-empty", "true");
    expect(within(groups[2]!).queryByTestId("group-toggle-files")).not.toBeInTheDocument();
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

  it("renders the group counts for a five-role response", () => {
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
    goSmart();
    const counts = ["1 file", "1 file", "2 files", "1 file", "1 file"];
    screen.getAllByTestId("smart-diff-group").forEach((g, i) => {
      expect(within(g).getByText(new RegExp(`^${counts[i]}$`))).toBeInTheDocument();
    });
  });

  it("always shows the fixed role order, whatever order the server returns", () => {
    smartDiffState.data = { ...SMART, groups: [...SMART.groups].reverse() };
    renderTab();
    goSmart();
    const roles = screen.getAllByTestId("smart-diff-group").map((g) => g.getAttribute("data-role"));
    expect(roles).toEqual(["core", "tests", "wiring", "docs", "boilerplate"]);
  });

  it("core/tests/wiring groups start expanded, docs/boilerplate collapsed; files start collapsed and the end button expands them all", () => {
    smartDiffState.data = SMART;
    renderTab();
    goSmart();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    // file rows are collapsed: patch bodies are hidden
    expect(screen.queryByText("corebody")).not.toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    const core = screen.getAllByTestId("smart-diff-group")[0]!;
    fireEvent.click(within(core).getByTestId("group-toggle-files"));
    expect(screen.getByText("corebody")).toBeInTheDocument();
    fireEvent.click(within(core).getByTestId("group-toggle-files"));
    expect(screen.queryByText("corebody")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Docs"));
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("Original order toggle removes group headers and renders GitHub order", () => {
    smartDiffState.data = SMART;
    renderTab();
    goSmart();
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
