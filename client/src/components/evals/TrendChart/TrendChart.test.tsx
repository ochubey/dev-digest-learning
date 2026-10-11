import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalsAgentPage from "../../../../messages/en/evalsAgentPage.json";
import { mkRun } from "@/app/evals/fixtures";
import { TrendChart } from "./TrendChart";
import { gridlines, labelIndexes, yRange } from "./helpers";

function mount(runs: Parameters<typeof TrendChart>[0]["runs"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evalsAgentPage }}>
      <TrendChart runs={runs} />
    </NextIntlClientProvider>,
  );
}

const run = (id: string, version: number, day: number, recall: number | null, extra = {}) =>
  mkRun({ id, agent_version: version, started_at: `2026-10-0${day}T10:00:00Z`, metrics: { recall, precision: 0.5, citation_accuracy: 1 }, ...extra });

afterEach(cleanup);

describe("TrendChart", () => {
  it("renders a labelled chart with 3 points per finished run, version labels, legend and tooltips", () => {
    mount([run("c", 3, 3, 0.9), run("a", 1, 1, 0.5), run("b", 2, 2, 0.7), run("f", 4, 4, null, { status: "failed" })]);
    const chart = screen.getByRole("img", { name: /Metric trend over 3 runs\./ });
    expect(chart).toHaveAccessibleName(/Recall from 50% to 90%\./);
    expect(chart).toHaveAccessibleName(/Citation from 100% to 100%\./);
    expect(screen.getAllByTestId("eval-trend-point")).toHaveLength(9);
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.queryByText("v4")).toBeNull();
    expect(screen.getByText("Recall, v2, Oct 2, 2026: 70%")).toBeInTheDocument();
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(legend).toHaveTextContent("RecallPrecisionCitation");
  });

  it("labels gridlines in percent", () => {
    mount([run("a", 1, 1, 0.5), run("b", 2, 2, 0.9)]);
    expect(screen.getByText("50%", { selector: "text" })).toBeInTheDocument();
  });

  it("shows muted messages for zero and one point", () => {
    mount([]);
    expect(screen.getByText("No finished runs in this time range.")).toBeInTheDocument();
    cleanup();
    mount([run("a", 1, 1, 0.5)]);
    expect(screen.getByText(/Only one finished run/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("skips null values instead of drawing them as zero", () => {
    mount([run("a", 1, 1, null), run("b", 2, 2, 0.5)]);
    expect(screen.getAllByTestId("eval-trend-point")).toHaveLength(5);
  });
});

describe("trend helpers", () => {
  it("yRange pads, snaps and stays inside 0..1", () => {
    expect(yRange([])).toEqual({ lo: 0, hi: 1 });
    expect(yRange([0.5, 0.9])).toEqual({ lo: 0.4, hi: 1 });
    expect(yRange([0.97, 1])).toEqual({ lo: 0.8, hi: 1 });
    expect(yRange([0, 0.02]).lo).toBe(0);
  });
  it("gridlines are inside the range", () => {
    expect(gridlines(0, 1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(gridlines(0.4, 1)).toEqual([0.5, 0.75, 1]);
    expect(gridlines(0.8, 1)).toEqual([0.8, 0.85, 0.9, 0.95, 1]);
  });
  it("labelIndexes thins long axes but keeps the last", () => {
    expect(labelIndexes(5).size).toBe(5);
    const many = labelIndexes(40);
    expect(many.has(39)).toBe(true);
    expect(many.size).toBeLessThanOrEqual(11);
  });
});
