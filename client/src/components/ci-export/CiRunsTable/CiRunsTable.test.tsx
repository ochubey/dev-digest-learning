import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { CiRun } from "@devdigest/shared";
import ciRuns from "../../../../messages/en/ciRuns.json";
import { CiRunsTable } from "./CiRunsTable";

afterEach(cleanup);

function mkRun(over: Partial<CiRun> = {}): CiRun {
  return {
    id: "r1",
    ci_installation_id: "i1",
    pr_number: 7,
    ran_at: "2026-10-11T10:00:00Z",
    status: "succeeded",
    findings_count: 3,
    cost_usd: 0.0123,
    github_url: "https://github.com/acme/api/actions/runs/1",
    source: "gha",
    agent: "Security Reviewer",
    repo: "acme/api",
    pr_title: "Add login",
    verdict: "REQUEST_CHANGES",
    critical: 1,
    warning: 2,
    suggestion: 0,
    duration_ms: 1500,
    reason: null,
    ...over,
  };
}

function mount(runs: CiRun[], showAgent: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ciRuns }}>
      <CiRunsTable runs={runs} showAgent={showAgent} />
    </NextIntlClientProvider>,
  );
}

describe("CiRunsTable", () => {
  it("columns incl. agent / without agent", () => {
    const { unmount } = mount([mkRun()], true);
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual([
      "Time", "Repository", "Pull request", "Agent", "Verdict", "Findings", "Cost", "Duration", "Status", "Job",
    ]);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("1 critical")).toBeInTheDocument();
    expect(screen.getByText("2 warning")).toBeInTheDocument();
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("$0.0123")).toBeInTheDocument();
    expect(screen.getByText("1.5 s")).toBeInTheDocument();
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    unmount();

    mount([mkRun()], false);
    const heads2 = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads2).not.toContain("Agent");
    expect(heads2).toHaveLength(9);
    expect(screen.queryByText("Security Reviewer")).not.toBeInTheDocument();
  });

  it("AC-73 href, target _blank, rel noopener noreferrer", () => {
    mount([mkRun()], true);
    const link = screen.getByRole("link", { name: "View job" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/api/actions/runs/1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it('AC-74 failed row: "Failed" + reason, "—" for unknown values', () => {
    mount(
      [
        mkRun({
          status: "failed",
          reason: "Missing OPENROUTER_API_KEY secret",
          verdict: null,
          critical: null,
          warning: null,
          suggestion: null,
          cost_usd: null,
          duration_ms: null,
          agent: null,
        }),
      ],
      true,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Missing OPENROUTER_API_KEY secret")).toBeInTheDocument();
    const row = screen.getAllByRole("row")[1]!;
    // agent, verdict, findings, cost, duration are all unknown -> "—"
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(5);
  });

  it("AC-80 <img onerror> title rendered as literal text; non-GitHub URL -> no link", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const { container } = mount(
      [mkRun({ pr_title: evil, agent: evil, reason: evil, github_url: "https://github.com.evil.io/x" })],
      true,
    );
    expect(screen.getAllByText(evil).length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("javascript: URL is not linked", () => {
    mount([mkRun({ github_url: "javascript:alert(1)" })], true);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
