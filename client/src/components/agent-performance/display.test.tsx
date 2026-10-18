import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { screen, cleanup } from "@testing-library/react";
import { renderWithIntl } from "./test-utils";
import { AcceptRate } from "./AcceptRate";
import { LastRun } from "./LastRun";
import { MetricSkeleton } from "./MetricSkeleton";

afterEach(cleanup);

describe("AcceptRate (AC-43)", () => {
  it("0 decisions: n/a with the denominator, no percentage", () => {
    renderWithIntl(<AcceptRate rate={null} accepted={0} decisions={0} />);
    expect(screen.getByText("n/a · 0 decisions")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });
  it("3 decisions: percentage, accepted/decisions and a low-sample marker", () => {
    renderWithIntl(<AcceptRate rate={2 / 3} accepted={2} decisions={3} />);
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("2/3")).toBeInTheDocument();
    expect(screen.getByText("low sample")).toBeInTheDocument();
  });
  it("8 decisions: percentage and fraction without the marker", () => {
    renderWithIntl(<AcceptRate rate={0.75} accepted={6} decisions={8} />);
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("6/8")).toBeInTheDocument();
    expect(screen.queryByText("low sample")).toBeNull();
  });
});

describe("LastRun (AC-50, AC-65)", () => {
  it("shows the last run in the period", () => {
    renderWithIntl(<LastRun lastRunAt="2026-10-18T09:30:00.000Z" allTime="2026-10-18T09:30:00.000Z" />);
    expect(screen.getByText("2026-10-18 09:30 UTC")).toBeInTheDocument();
  });
  it("no run in the period but one before: says so and gives the all-time date", () => {
    renderWithIntl(<LastRun lastRunAt={null} allTime="2026-08-01T08:00:00.000Z" />);
    expect(screen.getByText("No runs in period · last 2026-08-01 08:00 UTC")).toBeInTheDocument();
  });
  it("never run", () => {
    renderWithIntl(<LastRun lastRunAt={null} allTime={null} />);
    expect(screen.getByText("Never run")).toBeInTheDocument();
  });
});

describe("MetricSkeleton", () => {
  it("is a busy region with an accessible name and no numbers", () => {
    renderWithIntl(<MetricSkeleton count={4} />);
    const el = screen.getByLabelText("Loading agent performance");
    expect(el).toHaveAttribute("aria-busy", "true");
    expect(el.textContent).toBe("");
  });
});
