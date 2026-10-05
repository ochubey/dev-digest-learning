import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard scope", () => {
  it("renders the signal marker and the reason as literal plain text", () => {
    const reason = "Touches **auth** <b>x</b> [link](http://evil.test)";
    renderWithIntl(
      <FindingCard f={{ ...FINDING, scope: "signal", scope_reason: reason }} />,
    );
    expect(screen.getByText("Out of scope · serious")).toBeInTheDocument();
    const el = screen.getByTestId("finding-scope-reason");
    expect(el.textContent).toBe(reason);
    expect(el.querySelector("b, a, strong")).toBeNull();
    expect(el.innerHTML).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("signal without a reason shows only the marker", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, scope: "signal", scope_reason: null }} />);
    expect(screen.getByText("Out of scope · serious")).toBeInTheDocument();
    expect(screen.queryByTestId("finding-scope-reason")).not.toBeInTheDocument();
  });

  it("shows a small 'Out of scope' badge for out findings, no signal marker", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, scope: "out" }} muted />);
    expect(screen.getByText("Out of scope")).toBeInTheDocument();
    expect(screen.queryByText("Out of scope · serious")).not.toBeInTheDocument();
  });

  it("in-scope and legacy (null) findings show neither marker nor badge", () => {
    renderWithIntl(<FindingCard f={{ ...FINDING, scope: "in" }} />);
    cleanup();
    renderWithIntl(<FindingCard f={{ ...FINDING, scope: null }} />);
    expect(screen.queryByText(/Out of scope/)).not.toBeInTheDocument();
  });
});
