import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalsAgentPage from "../../../../../../../../messages/en/evalsAgentPage.json";
import { mkRun } from "@/app/evals/fixtures";
import { RunsAlertBanner } from "./RunsAlertBanner";

const m = (recall: number | null, precision: number | null, citation_accuracy: number | null) => ({ recall, precision, citation_accuracy });
const newest = (metrics: ReturnType<typeof m>, over = {}) => mkRun({ id: "n", agent_version: 4, started_at: "2026-10-05T10:00:00Z", metrics, ...over });
const older = mkRun({ id: "p", agent_version: 3, started_at: "2026-10-01T10:00:00Z", metrics: m(0.5, 0.5, 1) });

function mount(runs: Parameters<typeof RunsAlertBanner>[0]["runs"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ evalsAgentPage }}>
      <RunsAlertBanner runs={runs} />
    </NextIntlClientProvider>,
  );
}
afterEach(cleanup);

describe("RunsAlertBanner", () => {
  it("announces the dip with text and an icon label", () => {
    mount([newest(m(0.9, 0.4, 1)), older]);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Precision dipped 10pt on v4 — recall up 40pt, citation flat.");
    expect(banner.querySelector("svg")).toHaveAttribute("aria-label", "Warning");
  });
  it("lists several dropped metrics without a tail when none else", () => {
    mount([newest(m(0.4, 0.4, 0.9)), older]);
    expect(screen.getByRole("status")).toHaveTextContent("Recall dipped 10pt, Precision dipped 10pt, Citation dipped 10pt on v4.");
  });
  it("renders nothing without a drop or with fewer than two finished runs", () => {
    mount([newest(m(0.9, 0.5, 1)), older]);
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    mount([newest(m(0, 0, 0))]);
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    mount([newest(m(0, 0, 0), { status: "failed" }), older]);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
