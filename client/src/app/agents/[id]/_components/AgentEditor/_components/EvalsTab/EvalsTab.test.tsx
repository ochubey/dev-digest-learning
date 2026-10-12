import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCaseView, EvalSuiteRun } from "@devdigest/shared";
import evalsTab from "../../../../../../../../messages/en/evalsTab.json";
import evalsDashboard from "../../../../../../../../messages/en/evalsDashboard.json";
import evalsShared from "../../../../../../../../messages/en/evalsShared.json";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      del: (...a: unknown[]) => del(...a),
    },
  };
});

import { EvalsTab } from "./EvalsTab";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-test",
  system_prompt: "p",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 2,
  skill_count: 0,
};

type Kind = "must_find" | "must_not_flag";
function mkCase(
  id: string,
  name: string,
  kind: Kind,
  last: { status: "pass" | "fail" | "error"; matched: number; error?: string | null } | null,
  origin: EvalCaseView["origin"] = "seeded",
): EvalCaseView {
  return {
    id,
    agent_id: "ag1",
    name,
    expectation: { kind, file: "src/pay.ts", start_line: 10, end_line: 14 },
    input_diff: "",
    notes: null,
    origin,
    source_finding_id: null,
    source_pr_id: null,
    last_result: last ? { run_id: "r1", status: last.status, matched: last.matched, kind, error: last.error ?? null } : null,
  };
}

function mkRun(id: string, startedAt: string, over: Partial<EvalSuiteRun> = {}): EvalSuiteRun {
  return {
    id,
    agent_id: "ag1",
    agent_version: 2,
    status: "completed",
    error: null,
    cases_total: 9,
    cases_done: 9,
    metrics: { recall: 0.88, precision: 0.5, citation_accuracy: 1 },
    counts: {
      cases_scored: 8,
      cases_passed: 6,
      must_find_total: 4,
      must_find_hit: 3,
      must_not_flag_total: 4,
      must_not_flag_violated: 1,
      tp: 3,
      fp_zone: 1,
      fp_unlabeled: 2,
      grounded: 6,
      dropped: 0,
      cases_errored: 1,
    },
    duration_ms: 1000,
    cost_usd: 0.0123,
    started_at: startedAt,
    finished_at: startedAt,
    ...over,
  };
}

let casesData: EvalCaseView[] | Error;
let runsData: EvalSuiteRun[];

function route() {
  get.mockImplementation((url: string) => {
    if (url.includes("/eval-cases")) {
      return casesData instanceof Error ? Promise.reject(casesData) : Promise.resolve(casesData);
    }
    if (/\/eval-runs\/[^/?]+$/.test(url)) {
      return Promise.resolve({ ...runsData[0], manifest: null, results: [] });
    }
    if (url.includes("/eval-runs")) return Promise.resolve({ items: runsData, next_cursor: null });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ evalsTab, evalsShared, evalsDashboard }}>
        <EvalsTab agent={AGENT} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const NINE: EvalCaseView[] = [
  mkCase("c1", "Zeta must-not", "must_not_flag", { status: "pass", matched: 0 }, "dismissed_finding"),
  mkCase("c2", "Beta find", "must_find", { status: "fail", matched: 0 }, "accepted_finding"),
  mkCase("c3", "Alpha find", "must_find", { status: "pass", matched: 1 }),
  mkCase("c4", "Never run", "must_find", null),
  mkCase("c5", "Errored", "must_find", { status: "error", matched: 0, error: "timeout hit" }),
  mkCase("c6", "Gamma find", "must_find", { status: "pass", matched: 2 }),
  mkCase("c7", "Alpha must-not", "must_not_flag", { status: "fail", matched: 1 }),
  mkCase("c8", "Delta find", "must_find", { status: "pass", matched: 1 }),
  mkCase("c9", "Eps find", "must_find", { status: "pass", matched: 1 }),
];

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  del.mockReset();
  casesData = NINE;
  runsData = [mkRun("r1", "2026-10-11T10:00:00Z")];
  route();
});

describe("EvalsTab", () => {
  it("mixed fixture rows: result icon + label, name, kind badge text, origin, file:start–end, detail", async () => {
    mount();
    const rows = await screen.findAllByTestId("eval-case-row");
    expect(rows).toHaveLength(9);
    const byName = (n: string) => rows.find((r) => within(r).queryByText(n))!;

    const miss = byName("Beta find");
    expect(miss).toHaveTextContent("fail");
    expect(within(miss).getByTestId("eval-case-kind")).toHaveTextContent("must find");
    expect(miss).toHaveTextContent("from accepted finding");
    expect(miss).toHaveTextContent("src/pay.ts:10–14");
    expect(miss).toHaveTextContent("expected ≥1 matching finding, got 0");

    const clean = byName("Zeta must-not");
    expect(clean).toHaveTextContent("pass");
    expect(within(clean).getByTestId("eval-case-kind")).toHaveTextContent("must not flag");
    expect(clean).toHaveTextContent("from dismissed finding");
    expect(clean).toHaveTextContent("expected no matching finding, got 0");

    expect(byName("Never run")).toHaveTextContent("never run");
    expect(byName("Errored")).toHaveTextContent("error");
    expect(byName("Errored")).toHaveTextContent("run error: timeout hit");
    expect(byName("Alpha find")).toHaveTextContent("seeded");
  });

  it("order: must find first, then name ascending", async () => {
    mount();
    const rows = await screen.findAllByTestId("eval-case-row");
    const names = rows.map((r) => within(r).getByTestId("eval-case-name").textContent);
    expect(names).toEqual([
      "Alpha find",
      "Beta find",
      "Delta find",
      "Eps find",
      "Errored",
      "Gamma find",
      "Never run",
      "Alpha must-not",
      "Zeta must-not",
    ]);
  });

  it('"6 / 8 passing" and "9 cases"', async () => {
    mount();
    expect(await screen.findByText("6 / 8 passing")).toBeInTheDocument();
    expect(screen.getByText("9 cases")).toBeInTheDocument();
    expect(screen.getByTestId("eval-metric-recall")).toHaveTextContent("88%");
    expect(screen.getByTestId("eval-metric-passed")).toHaveTextContent("6/8");
  });

  it("empty state text + Run disabled", async () => {
    casesData = [];
    runsData = [];
    mount();
    expect(await screen.findByText("No eval cases yet")).toBeInTheDocument();
    expect(
      screen.getByText("Open a PR review, accept or dismiss a finding, then use Turn into eval case."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("eval-run-button")).toBeDisabled();
    expect(screen.queryByTestId("eval-case-row")).toBeNull();
    expect(screen.queryByTestId("eval-metric-strip-empty")).toBeNull();
    expect(screen.getByText("0 cases")).toBeInTheDocument();
  });

  it("never run agent with cases -> No eval runs yet, no passing badge", async () => {
    runsData = [];
    mount();
    await screen.findAllByTestId("eval-case-row");
    expect(screen.getByTestId("eval-metric-strip-empty")).toHaveTextContent("No eval runs yet");
    expect(screen.queryByText(/passing/)).toBeNull();
  });

  it("delete confirm then request", async () => {
    del.mockResolvedValue({ ok: true });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Delete case Alpha find" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete case Alpha find" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete case" }));
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(del.mock.calls[0]?.[0]).toBe("/eval-cases/c3");
  });

  it("loading placeholder; error + Retry", async () => {
    casesData = new Error("boom");
    mount();
    expect(screen.getByRole("status", { name: "Loading eval cases" })).toBeInTheDocument();
    expect(await screen.findByText("Couldn’t load eval cases")).toBeInTheDocument();
    casesData = NINE;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByTestId("eval-case-row")).toHaveLength(9);
  });

  it("polling completion refreshes strip, rows, history", async () => {
    runsData = [mkRun("r2", "2026-10-11T11:00:00Z", { status: "running", cases_done: 3, metrics: { recall: null, precision: null, citation_accuracy: null }, counts: null })];
    casesData = [mkCase("c1", "Only", "must_find", null)];
    mount();
    await screen.findByText("Running 3 / 9 cases");
    expect(screen.getByTestId("eval-case-row")).toHaveTextContent("never run");

    runsData = [mkRun("r2", "2026-10-11T11:00:00Z", { cases_total: 1, cases_done: 1, counts: { ...mkRun("x", "").counts!, cases_scored: 1, cases_passed: 1 } })];
    casesData = [mkCase("c1", "Only", "must_find", { status: "pass", matched: 1 })];
    await waitFor(() => expect(screen.getByTestId("eval-case-row")).toHaveTextContent("pass"), { timeout: 6000 });
    expect(screen.getByText("1 / 1 passing")).toBeInTheDocument();
    expect(screen.getByTestId("eval-metric-recall")).toHaveTextContent("88%");
    expect(screen.getAllByTestId("eval-tab-run-row")[0]).toHaveTextContent("completed");
  }, 12000);

  it("12 runs -> 10 rows + link /evals/<agentId>", async () => {
    runsData = Array.from({ length: 12 }, (_, i) =>
      mkRun(`r${i}`, `2026-10-${String(20 - i).padStart(2, "0")}T10:00:00Z`),
    );
    mount();
    expect(await screen.findAllByTestId("eval-tab-run-row")).toHaveLength(10);
    const link = screen.getByTestId("eval-dashboard-link");
    expect(link).toHaveAttribute("href", "/evals/ag1");
    expect(link).toHaveTextContent("View full dashboard");
    const first = screen.getAllByTestId("eval-tab-run-row")[0]!;
    expect(first).toHaveTextContent("v2");
    expect(first).toHaveTextContent("88%");
    expect(first).toHaveTextContent("6/8");
    expect(first).toHaveTextContent("$0.0123");
  });

  it("Model column: short run model with full id in title, dash when null", async () => {
    runsData = [
      { ...mkRun("r1", "2026-10-20T10:00:00Z"), model: "deepseek/deepseek-v4-flash" },
      { ...mkRun("r2", "2026-10-19T10:00:00Z"), model: null },
    ];
    mount();
    const rows = await screen.findAllByTestId("eval-tab-run-row");
    expect(screen.getByRole("columnheader", { name: "Model" })).toBeInTheDocument();
    expect(within(rows[0]!).getByText("deepseek-v4-flash")).toHaveAttribute("title", "deepseek/deepseek-v4-flash");
    expect(within(rows[1]!).getByText("—")).toBeInTheDocument();
  });

  it("run row opens the run detail drawer (AC-65)", async () => {
    mount();
    const row = (await screen.findAllByTestId("eval-tab-run-row"))[0]!;
    fireEvent.click(within(row).getByRole("button", { name: /Open run details for/ }));
    const drawer = await screen.findByTestId("eval-run-drawer");
    expect(drawer).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/eval-runs/r1");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("eval-run-drawer")).toBeNull());
  });

  it("hostile case name plain text", async () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    casesData = [mkCase("c1", hostile, "must_find", { status: "error", matched: 0, error: "<b>bad</b>" })];
    const { container } = mount();
    const row = await screen.findByTestId("eval-case-row");
    expect(within(row).getByText(hostile)).toBeInTheDocument();
    expect(row).toHaveTextContent("<b>bad</b>");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });
});
