import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";
import type { PrDetail } from "@/lib/types";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  latest: { data: undefined as { id: string | null } | undefined, isLoading: false },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push, replace: vi.fn() }) }));
vi.mock("@/lib/hooks/multi-agent", () => ({ useLatestMultiAgentRunForPr: () => h.latest }));
vi.mock("../RunReviewDropdown", () => ({ RunReviewDropdown: () => <div>run-review-dropdown</div> }));

import { PrDetailHeader } from "./PrDetailHeader";

afterEach(() => {
  cleanup();
  h.push.mockReset();
  h.latest = { data: undefined, isLoading: false };
});

const pr = {
  number: 7,
  title: "Fix",
  author: "ann",
  branch: "f",
  base: "main",
  additions: 1,
  deletions: 2,
  status: "open",
  files_count: 1,
} as unknown as PrDetail;

function renderHeader() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PrDetailHeader
        pr={pr}
        prId="pr1"
        repoId="r1"
        tab="overview"
        findingsCount={0}
        onSetTab={vi.fn()}
        onRunStart={vi.fn()}
        onRunsStarted={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("PrDetailHeader multi-agent view button", () => {
  it("shows the button and opens the run results when the PR has a multi-agent run", () => {
    h.latest = { data: { id: "m1" }, isLoading: false };
    renderHeader();
    fireEvent.click(screen.getByText("Multi-agent view"));
    expect(h.push).toHaveBeenCalledWith("/repos/r1/multi-agent/m1");
  });

  it("hides the button when the PR has no multi-agent run", () => {
    h.latest = { data: { id: null }, isLoading: false };
    renderHeader();
    expect(screen.queryByText("Multi-agent view")).not.toBeInTheDocument();
  });

  it("hides the button while loading", () => {
    h.latest = { data: undefined, isLoading: true };
    renderHeader();
    expect(screen.queryByText("Multi-agent view")).not.toBeInTheDocument();
  });
});
