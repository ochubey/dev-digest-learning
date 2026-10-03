import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";
import { visibleFindings } from "./helpers";

afterEach(cleanup);

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

const mk = (id: string, over: Partial<FindingRecord> = {}): FindingRecord => ({
  ...FINDINGS[0]!,
  id,
  title: `title-${id}`,
  ...over,
});

describe("FindingsPanel scope", () => {
  it("visibleFindings drops out unless showOut", () => {
    const list = [mk("a", { scope: "in" }), mk("b", { scope: "out" }), mk("c", { scope: "signal" })];
    expect(visibleFindings(list, false, null).map((f) => f.id).sort()).toEqual(["a", "c"]);
    expect(visibleFindings(list, false, null, true).map((f) => f.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("hides out findings by default and shows the plural counter + reveal toggle", () => {
    renderWithIntl(
      <FindingsPanel
        findings={[mk("a", { scope: "in" }), mk("b", { scope: "out" }), mk("c", { scope: "out" })]}
        prId="pr1"
      />,
    );
    expect(screen.getByText("title-a")).toBeInTheDocument();
    expect(screen.queryByText("title-b")).not.toBeInTheDocument();
    expect(screen.getByText(/^2 findings hidden as out of scope$/)).toBeInTheDocument();
    expect(screen.getByText("Show out-of-scope findings")).toBeInTheDocument();
  });

  it("uses the singular for exactly 1 hidden finding", () => {
    renderWithIntl(
      <FindingsPanel findings={[mk("a"), mk("b", { scope: "out" })]} prId="pr1" />,
    );
    expect(screen.getByText(/^1 finding hidden as out of scope$/)).toBeInTheDocument();
  });

  it("dismissed out findings are not counted as hidden", () => {
    renderWithIntl(
      <FindingsPanel
        findings={[mk("a"), mk("b", { scope: "out", dismissed_at: "2026-01-01T00:00:00Z" })]}
        prId="pr1"
      />,
    );
    expect(screen.queryByText(/hidden as out of scope/)).not.toBeInTheDocument();
  });

  it("renders no counter and no reveal toggle when nothing is hidden", () => {
    renderWithIntl(
      <FindingsPanel findings={[mk("a", { scope: "in" }), mk("s", { scope: "signal" })]} prId="pr1" />,
    );
    expect(screen.queryByText(/hidden as out of scope/)).not.toBeInTheDocument();
    expect(screen.queryByText("Show out-of-scope findings")).not.toBeInTheDocument();
    expect(screen.getByText("title-s")).toBeInTheDocument();
  });

  it("reveal shows out cards muted, and conceal hides them again", () => {
    renderWithIntl(
      <FindingsPanel findings={[mk("a"), mk("b", { scope: "out" })]} prId="pr1" />,
    );
    fireEvent.click(screen.getByRole("switch", { name: /out-of-scope findings$/ }));
    const card = screen.getByText("title-b").closest("[data-finding-id]") as HTMLElement;
    expect(card).toBeInTheDocument();
    expect(card.style.opacity).toBe("0.6");
    expect(screen.getByText("Out of scope")).toBeInTheDocument();
    expect(screen.getByText("Hide out-of-scope findings")).toBeInTheDocument();
  });

  it("reports only in-scope visible count (no out, no signal) via onVisibleCountChange", () => {
    const spy = vi.fn();
    renderWithIntl(
      <FindingsPanel
        findings={[mk("a"), mk("b", { scope: "out" }), mk("s", { scope: "signal" })]}
        prId="pr1"
        onVisibleCountChange={spy}
      />,
    );
    expect(spy).toHaveBeenLastCalledWith(1);
    fireEvent.click(screen.getByRole("switch", { name: /out-of-scope findings$/ }));
    expect(spy).toHaveBeenLastCalledWith(1);
  });
});
