import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { FindingRecord } from "@devdigest/shared";
import { SeverityCountBadges } from "./SeverityCountBadges";
import { countBySeverity } from "./helpers";

afterEach(cleanup);

function finding(overrides: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "security",
    title: "t",
    file: "src/x.ts",
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
    ...overrides,
  };
}

const FINDINGS: FindingRecord[] = [
  finding({ id: "f1", severity: "CRITICAL" }),
  finding({ id: "f2", severity: "CRITICAL" }),
  finding({ id: "f3", severity: "CRITICAL" }),
  finding({ id: "f4", severity: "WARNING" }),
  finding({ id: "f5", severity: "SUGGESTION" }),
];

describe("countBySeverity", () => {
  it("tallies each severity, ignoring unknown values", () => {
    expect(countBySeverity(FINDINGS)).toEqual({ CRITICAL: 3, WARNING: 1, SUGGESTION: 1 });
    expect(countBySeverity([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });
});

describe("SeverityCountBadges", () => {
  it("renders one badge per severity present, with counts, in fixed order", () => {
    render(<SeverityCountBadges findings={FINDINGS} activeSeverity={null} onChange={vi.fn()} />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(screen.getByText("Suggestion")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("does not render a badge for a severity with zero findings", () => {
    render(
      <SeverityCountBadges
        findings={[finding({ severity: "CRITICAL" })]}
        activeSeverity={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Warning")).not.toBeInTheDocument();
  });

  it("renders nothing when there are no findings", () => {
    const { container } = render(
      <SeverityCountBadges findings={[]} activeSeverity={null} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("clicking a severity badge selects it", () => {
    const onChange = vi.fn();
    render(<SeverityCountBadges findings={FINDINGS} activeSeverity={null} onChange={onChange} />);
    fireEvent.click(screen.getByText("Critical").closest("button")!);
    expect(onChange).toHaveBeenCalledWith("CRITICAL");
  });

  it("clicking the already-active severity badge clears the filter", () => {
    const onChange = vi.fn();
    render(<SeverityCountBadges findings={FINDINGS} activeSeverity="CRITICAL" onChange={onChange} />);
    fireEvent.click(screen.getByText("Critical").closest("button")!);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
