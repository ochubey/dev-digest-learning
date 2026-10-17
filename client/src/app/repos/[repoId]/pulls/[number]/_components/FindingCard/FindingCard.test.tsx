import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
const notifyMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/toast", () => ({ notify: notifyMock }));

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

describe("FindingCard eval case action", () => {
  it("accepted and dismissed: enabled, no hint", () => {
    for (const decided of [{ accepted_at: "2026-10-11T10:00:00Z" }, { dismissed_at: "2026-10-11T10:00:00Z" }]) {
      const { unmount } = renderWithIntl(<FindingCard f={{ ...FINDING, ...decided }} defaultExpanded />);
      expect(screen.getByRole("button", { name: "Turn into eval case" })).toBeEnabled();
      expect(screen.queryByText("Accept or dismiss the finding first")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("undecided: disabled with the hint", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded />);
    const btn = screen.getByRole("button", { name: "Turn into eval case" });
    expect(btn).toBeDisabled();
    const hint = screen.getByText("Accept or dismiss the finding first");
    expect(btn).toHaveAttribute("aria-describedby", hint.id);
  });

  it("shows Learn between Dismiss and the eval case, and confirms after success", () => {
    const onAction = vi.fn((_a, _r, opts) => opts?.onSuccess?.());
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels.indexOf("Learn")).toBe(labels.indexOf("Dismiss") + 1);
    fireEvent.click(screen.getByText("Learn"));
    expect(onAction).toHaveBeenCalledWith("learn", undefined, expect.any(Object));
    expect(notifyMock.success).toHaveBeenCalled();
    const done = screen.getByRole("button", { name: "Learned" });
    expect(done).toBeDisabled();
    expect(done).toHaveAttribute("title", "Saved to the repository memory");
  });

  it("toasts the error and keeps Learn enabled when saving fails", () => {
    const onAction = vi.fn((_a, _r, opts) => opts?.onError?.(new Error("boom")));
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Learn"));
    expect(notifyMock.error).toHaveBeenCalledWith("Could not save to memory: boom");
    expect(screen.getByRole("button", { name: "Learn" })).toBeEnabled();
  });
});

describe("FindingCard reply to author", () => {
  const mutate = vi.hoisted(() => vi.fn());
  const hookState = vi.hoisted(() => ({ isPending: false }));
  vi.mock("@/lib/hooks/reviews", () => ({
    useReplyToFinding: () => ({ mutate, isPending: hookState.isPending }),
  }));

  const open = () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded prId="pr1" />);
    fireEvent.click(screen.getByRole("button", { name: "Reply to author" }));
    return screen.getByPlaceholderText("Reply to the author about this finding…") as HTMLTextAreaElement;
  };

  it("is the last action and hidden without a prId", () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded prId="pr1" />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels.slice(-1)).toEqual(["Reply to author"]);
    expect(labels.slice(-3, -1)).toEqual(["Learn", "Turn into eval case"]);
    cleanup();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded />);
    expect(screen.queryByText("Reply to author")).not.toBeInTheDocument();
  });

  it("toggles the textarea and disables Send while blank", () => {
    const ta = open();
    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
    fireEvent.change(ta, { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
    fireEvent.change(ta, { target: { value: "hi" } });
    expect(screen.getByRole("button", { name: "Send reply" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Reply to author" }));
    expect(screen.queryByPlaceholderText(/Reply to the author/)).not.toBeInTheDocument();
  });

  it("sends {prId,file,line,body}, then clears, collapses and toasts", () => {
    mutate.mockImplementation((_v, o) => o.onSuccess());
    const ta = open();
    fireEvent.change(ta, { target: { value: "<b>thanks</b>" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(mutate).toHaveBeenCalledWith(
      { prId: "pr1", file: "src/config.ts", line: 11, body: "<b>thanks</b>" },
      expect.any(Object),
    );
    expect(notifyMock.success).toHaveBeenCalledWith("Reply posted to the pull request.");
    expect(screen.queryByPlaceholderText(/Reply to the author/)).not.toBeInTheDocument();
  });

  it("keeps the text and toasts the server message on error", () => {
    mutate.mockImplementation((_v, o) => o.onError(new Error("nope")));
    const ta = open();
    fireEvent.change(ta, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    expect(notifyMock.error).toHaveBeenCalledWith("Could not send the reply: nope");
    expect(ta.value).toBe("hello");
    expect(screen.getByRole("button", { name: "Send reply" })).toBeEnabled();
  });

  it("disables Send while sending", () => {
    hookState.isPending = true;
    const ta = open();
    fireEvent.change(ta, { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
    hookState.isPending = false;
  });
});
