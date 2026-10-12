import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import evalsDashboard from "../../../../messages/en/evalsDashboard.json";
import { mkDetail, mkResult, mkRun } from "@/app/evals/fixtures";

const get = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, get: (...a: unknown[]) => get(...a) } };
});

import { RunDetailDrawer } from "./RunDetailDrawer";

const onClose = vi.fn();
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ evalsDashboard }}>
        <RunDetailDrawer run={mkRun({ id: "r1", agent_version: 3 })} onClose={onClose} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  onClose.mockReset();
});
afterEach(cleanup);

const finding = (over = {}) => ({
  file: "src/db.ts",
  start_line: 10,
  end_line: 11,
  severity: "CRITICAL" as const,
  category: "security" as const,
  title: "SQL built from user input",
  match: "tp" as const,
  ...over,
});

describe("RunDetailDrawer", () => {
  it("per-case name, kind, pass/fail/error, matched + unlabeled file:lines, dropped with reason, error message", async () => {
    get.mockResolvedValue(
      mkDetail({
        results: [
          mkResult({
            id: "x1",
            case_name: "Case <b>bold</b>",
            grounded: [finding(), finding({ file: "src/other.ts", start_line: 3, end_line: 4, title: "Unrelated nit", match: "unlabeled" })],
            dropped: [{ file: "src/ghost.ts", start_line: 99, end_line: 100, title: "Phantom", reason: "lines not in diff" }],
          }),
          mkResult({
            id: "x2",
            case_name: "Quiet case",
            expectation: { kind: "must_not_flag", file: "src/a.ts", start_line: 1, end_line: 2 },
            pass: false,
          }),
          mkResult({ id: "x3", case_name: "Broken case", status: "error", pass: null, error: "provider timeout" }),
        ],
      }),
    );
    mount();
    const cases = await screen.findAllByTestId("eval-case-result");
    expect(cases).toHaveLength(3);

    const byName = (n: string) => cases.find((c) => c.textContent?.includes(n))!;
    const [card1, card2, card3] = [byName("Case <b>"), byName("Quiet case"), byName("Broken case")];
    const c1 = within(card1);
    // Hostile text is a plain text node, never HTML (AC-83).
    expect(c1.getByText("Case <b>bold</b>")).toBeInTheDocument();
    expect(card1.querySelector("b")).toBeNull();
    expect(c1.getByText("Must find")).toBeInTheDocument();
    expect(c1.getByText("Pass")).toBeInTheDocument();
    expect(c1.getByText(/src\/db\.ts:10-11/)).toBeInTheDocument();
    expect(c1.getByText(/src\/other\.ts:3-4/)).toBeInTheDocument();
    expect(c1.getByText("Matched findings")).toBeInTheDocument();
    expect(c1.getByText("Unlabeled findings")).toBeInTheDocument();
    expect(c1.getByText(/src\/ghost\.ts:99-100/)).toBeInTheDocument();
    expect(c1.getByText("Dropped: lines not in diff")).toBeInTheDocument();

    expect(within(card2).getByText("Must not flag")).toBeInTheDocument();
    expect(within(card2).getByText("Fail")).toBeInTheDocument();
    expect(within(card3).getByText("Error")).toBeInTheDocument();
    expect(within(card3).getByText("Error: provider timeout")).toBeInTheDocument();
  });

  it("labeled dialog; Escape closes", async () => {
    get.mockResolvedValue(mkDetail({ results: [mkResult()] }));
    mount();
    const dlg = screen.getByRole("dialog");
    expect(dlg).toHaveAccessibleName(/Run .* · v3/);
    await screen.findAllByTestId("eval-case-result");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("run-level error and load error", async () => {
    get.mockResolvedValueOnce(mkDetail({ status: "failed", error: "interrupted", results: [] }));
    mount();
    expect(await screen.findByText("Run error: interrupted")).toBeInTheDocument();
    cleanup();
    get.mockReset();
    get.mockRejectedValue(new Error("x"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this run.");
  });
});
