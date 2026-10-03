import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import prReview from "../../../../messages/en/prReview.json";

const mutate = vi.fn();
const actionState = { isPending: false };
vi.mock("@/lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate, isPending: actionState.isPending }),
}));

import { SmartFindingCard } from "./SmartFindingCard";

afterEach(() => {
  cleanup();
  mutate.mockReset();
  actionState.isPending = false;
});

const F: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/a.ts",
  start_line: 3,
  end_line: 3,
  rationale: "A **live** key is committed.",
  confidence: 0.9,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderCard(f: FindingRecord, prId: string | null = "pr1") {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview }}>
      <SmartFindingCard finding={f} prId={prId} />
    </NextIntlClientProvider>,
  );
}

describe("SmartFindingCard", () => {
  it("shows title and rationale", () => {
    renderCard(F);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();
  });

  it.each([
    ["CRITICAL", "blocker"],
    ["WARNING", "warning"],
    ["SUGGESTION", "suggestion"],
  ] as const)("maps %s to the %s label", (sev, label) => {
    renderCard({ ...F, severity: sev });
    expect(screen.getByTestId("smart-finding-label").textContent).toBe(label);
  });

  it("falls back to suggestion for an unknown severity without crashing", () => {
    renderCard({ ...F, severity: "INFO" as unknown as FindingRecord["severity"] });
    expect(screen.getByTestId("smart-finding-label").textContent).toBe("suggestion");
  });

  it("unknown severity uses SUGGESTION for label, colour and icon alike", () => {
    const { container, unmount } = renderCard({ ...F, severity: "SUGGESTION" });
    const ref = {
      color: screen.getByTestId("smart-finding-card").style.borderLeftColor,
      icon: container.querySelector("svg")!.outerHTML,
      label: screen.getByTestId("smart-finding-label").textContent,
    };
    unmount();
    const r = renderCard({ ...F, severity: "INFO" as unknown as FindingRecord["severity"] });
    expect(screen.getByTestId("smart-finding-card").style.borderLeftColor).toBe(ref.color);
    expect(r.container.querySelector("svg")!.outerHTML).toBe(ref.icon);
    expect(screen.getByTestId("smart-finding-label").textContent).toBe(ref.label);
  });

  it("Accept and Dismiss call useFindingAction with the finding id and prId", () => {
    renderCard(F);
    fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
    expect(mutate).toHaveBeenLastCalledWith({ findingId: "f1", action: "accept", prId: "pr1" });
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(mutate).toHaveBeenLastCalledWith({ findingId: "f1", action: "dismiss", prId: "pr1" });
  });

  it("disables the buttons while an action is pending", () => {
    actionState.isPending = true;
    renderCard(F);
    expect(screen.getByRole("button", { name: /Accept/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Dismiss/ })).toBeDisabled();
  });

  it("shows accepted / dismissed state like FindingCard", () => {
    const { unmount } = renderCard({ ...F, accepted_at: "2026-01-01T00:00:00Z" });
    expect(screen.getByText("accepted")).toBeInTheDocument();
    unmount();
    renderCard({ ...F, dismissed_at: "2026-01-01T00:00:00Z" });
    expect(screen.getByText("dismissed")).toBeInTheDocument();
  });
});
