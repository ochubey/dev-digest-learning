import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(cleanup);

const fi = (id: string, severity: FindingRecord["severity"], over: Partial<FindingRecord> = {}): FindingRecord => ({
  id,
  severity,
  category: "bug",
  title: `title-${id}`,
  file: "a.ts",
  start_line: 1,
  end_line: 1,
  rationale: "r",
  suggestion: null,
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
  ...over,
});

const review = (findings: FindingRecord[]): ReviewRecord => ({
  id: "r1",
  pr_id: "pr1",
  agent_id: "A",
  agent_name: "Agent A",
  run_id: "run1",
  kind: "review",
  verdict: "request_changes",
  summary: null,
  score: null,
  model: null,
  created_at: "2026-01-01T00:00:00Z",
  findings,
} as ReviewRecord);

// in: 1 CRITICAL + legacy(null) 1 WARNING; out: CRITICAL + WARNING; signal: CRITICAL
const FINDINGS = [
  fi("in-crit", "CRITICAL", { scope: "in" }),
  fi("legacy-warn", "WARNING", { scope: null }),
  fi("out-crit", "CRITICAL", { scope: "out" }),
  fi("out-warn", "WARNING", { scope: "out" }),
  fi("out-sug", "SUGGESTION", { scope: "out" }),
  fi("sig-crit", "CRITICAL", { scope: "signal", scope_reason: "why" }),
];

function renderIt(defaultOpen: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <ReviewRunAccordion review={review(FINDINGS)} prId="pr1" defaultOpen={defaultOpen} />
    </NextIntlClientProvider>,
  );
}

describe("ReviewRunAccordion scope counting", () => {
  it("collapsed header counts only in-scope findings and blockers", () => {
    renderIt(false);
    expect(screen.getByText(/^2 findings · 1 blocker$/)).toBeInTheDocument();
  });

  it("open: banner, severity badges and blockers exclude out and signal", () => {
    renderIt(true);
    expect(screen.getByText(/^2 findings · 1 blocker$/)).toBeInTheDocument();
    expect(screen.getByText(/^2 findings · 1 blockers$/)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { pressed: false });
    const crit = buttons.find((b) => /Critical/.test(b.textContent ?? ""))!;
    const warn = buttons.find((b) => /Warning/.test(b.textContent ?? ""))!;
    expect(crit.textContent).toBe("Critical1");
    expect(warn.textContent).toBe("Warning1");
    expect(buttons.some((b) => /Suggestion/.test(b.textContent ?? ""))).toBe(false);
  });

  it("open: signal is rendered (marker) while out stays hidden behind the counter", () => {
    renderIt(true);
    expect(screen.getByText("title-sig-crit")).toBeInTheDocument();
    expect(screen.getByText("Out of scope · serious")).toBeInTheDocument();
    expect(screen.queryByText("title-out-crit")).not.toBeInTheDocument();
    expect(screen.getByText(/^3 findings hidden as out of scope$/)).toBeInTheDocument();
  });
});
