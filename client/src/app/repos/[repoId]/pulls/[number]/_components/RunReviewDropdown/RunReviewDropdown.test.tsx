import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: "a1", name: "Security", model: "gpt-4.1", enabled: true }] }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(() => {
  cleanup();
  push.mockReset();
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

describe("RunReviewDropdown multi-agent item", () => {
  it('"Multi-agent review…" sits between Run all and the agent list and navigates to /repos/<repoId>/multi-agent?pr=<number>', () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" repoId="r1" prNumber={482} />);
    fireEvent.click(screen.getByText("Run Review"));

    const runAll = screen.getByText(messages.runReview.runAll);
    const multi = screen.getByText("Multi-agent review…");
    const agent = screen.getByText("Security");
    expect(messages.runReview.multiAgent).toBe("Multi-agent review…");
    expect(runAll.compareDocumentPosition(multi) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(multi.compareDocumentPosition(agent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(multi);
    expect(push).toHaveBeenCalledWith("/repos/r1/multi-agent?pr=482");
  });

  it("omits the multi-agent item without repoId and prNumber", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));
    expect(screen.queryByText("Multi-agent review…")).not.toBeInTheDocument();
  });
});
