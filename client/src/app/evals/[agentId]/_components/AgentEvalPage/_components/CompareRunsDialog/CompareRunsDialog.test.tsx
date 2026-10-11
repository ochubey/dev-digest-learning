import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCompare } from "@devdigest/shared";
import evalsDashboard from "../../../../../../../../messages/en/evalsDashboard.json";
import { mkDetail, mkManifest, mkResult, mkRun } from "@/app/evals/fixtures";

const get = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, get: (...a: unknown[]) => get(...a) } };
});

import { CompareRunsDialog } from "./CompareRunsDialog";

const older = mkRun({ id: "old", agent_version: 1, started_at: "2026-10-01T10:00:00Z", metrics: { recall: 0.5, precision: 0.5, citation_accuracy: null }, cost_usd: 0.01 });
const newer = mkRun({ id: "new", agent_version: 2, started_at: "2026-10-05T10:00:00Z", metrics: { recall: 0.75, precision: 0.25, citation_accuracy: 1 }, cost_usd: 0.02 });

function cmp(over: Partial<EvalCompare> = {}): EvalCompare {
  return {
    a: mkDetail({ ...older, results: [] }),
    b: mkDetail({ ...newer, results: [] }),
    ...over,
  };
}

const onClose = vi.fn();
function mount(runs: [typeof older, typeof older] = [newer, older], extra?: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ evalsDashboard }}>
        {extra}
        <CompareRunsDialog runs={runs} onClose={onClose} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  onClose.mockReset();
});
afterEach(cleanup);

describe("CompareRunsDialog", () => {
  it('newer selected first -> "Compare runs · v1 → v2", A older left', async () => {
    get.mockResolvedValue(cmp());
    mount([newer, older]);
    expect(screen.getByRole("dialog", { name: "Compare runs · v1 → v2" })).toBeInTheDocument();
    expect(screen.getByTestId("eval-compare-dialog")).toBeInTheDocument();
    await screen.findByText("Metric");
    expect(get).toHaveBeenCalledWith(expect.stringContaining("a=old&b=new"));
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.slice(1, 3)).toEqual(["A · v1", "B · v2"]);
  });

  it('recall/precision/citation/cost cells A, B, delta with ▲/▼, "—" for null', async () => {
    get.mockResolvedValue(cmp());
    mount();
    await screen.findByText("Metric");
    const deltas = screen.getAllByTestId("eval-compare-delta").map((d) => d.textContent);
    expect(deltas).toEqual(["▲ 25pt", "▼ 25pt", "—", "▲ $0.0100"]);
    const recall = screen.getByRole("row", { name: /Recall/ });
    expect(within(recall).getByText("50%")).toBeInTheDocument();
    expect(within(recall).getByText("75%")).toBeInTheDocument();
    const citation = screen.getByRole("row", { name: /Citation accuracy/ });
    expect(within(citation).getByText("100%")).toBeInTheDocument();
    expect(within(citation).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("prompt diff: removed with strikethrough, added with underline, \"System prompt unchanged\" when equal; model line", async () => {
    get.mockResolvedValue(
      cmp({
        a: mkDetail({ ...older, manifest: mkManifest({ system_prompt: "Be terse and strict", model: "gpt-a" }) }),
        b: mkDetail({ ...newer, manifest: mkManifest({ system_prompt: "Be thorough and strict", model: "gpt-b" }) }),
      }),
    );
    mount();
    const del = await screen.findByTestId("eval-prompt-del");
    const ins = screen.getByTestId("eval-prompt-ins");
    expect(del).toHaveTextContent("terse");
    expect(del.style.textDecoration).toContain("line-through");
    expect(ins).toHaveTextContent("thorough");
    expect(ins.style.textDecoration).toContain("underline");
    expect(screen.queryByText("System prompt unchanged")).toBeNull();
    expect(screen.getByText("Model: gpt-a → gpt-b")).toBeInTheDocument();
    cleanup();

    get.mockResolvedValue(cmp());
    mount();
    expect(await screen.findByText("System prompt unchanged")).toBeInTheDocument();
    expect(screen.queryByTestId("eval-prompt-ins")).toBeNull();
  });

  it("Regressed/Fixed/Errored groups + unchanged count", async () => {
    const r = (id: string, name: string, over = {}) => mkResult({ id: `${id}${name}`, case_id: id, case_name: name, ...over });
    get.mockResolvedValue(
      cmp({
        a: mkDetail({
          ...older,
          results: [r("1", "reg"), r("2", "fix", { pass: false }), r("3", "err"), r("4", "same1"), r("5", "same2")],
        }),
        b: mkDetail({
          ...newer,
          results: [
            r("1", "reg", { pass: false }),
            r("2", "fix", { pass: true }),
            r("3", "err", { status: "error", pass: null, error: "x" }),
            r("4", "same1"),
            r("5", "same2"),
          ],
        }),
      }),
    );
    mount();
    const reg = await screen.findByRole("group", { name: "Regressed" });
    expect(within(reg).getByText("reg: pass → fail")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Fixed" })).getByText("fix: fail → pass")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Errored" })).getByText("err: pass → error")).toBeInTheDocument();
    expect(screen.getByText("2 cases unchanged")).toBeInTheDocument();
    expect(screen.queryByText(/Case sets differ/)).toBeNull();
  });

  it("case sets differ notice with N/M and separate lists", async () => {
    get.mockResolvedValue(
      cmp({
        a: mkDetail({ ...older, results: [mkResult({ id: "x", case_id: "1", case_name: "kept" }), mkResult({ id: "y", case_id: "2", case_name: "deleted case" })] }),
        b: mkDetail({
          ...newer,
          results: [
            mkResult({ id: "x2", case_id: "1", case_name: "kept" }),
            mkResult({ id: "z", case_id: "3", case_name: "added one" }),
            mkResult({ id: "w", case_id: "4", case_name: "added two" }),
          ],
        }),
      }),
    );
    mount();
    expect(
      await screen.findByText("Case sets differ: 1 only in A, 2 only in B. Metrics are not directly comparable."),
    ).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Only in A" })).getByText("deleted case")).toBeInTheDocument();
    const onlyB = within(screen.getByRole("group", { name: "Only in B" }));
    expect(onlyB.getByText("added one")).toBeInTheDocument();
    expect(onlyB.getByText("added two")).toBeInTheDocument();
  });

  it("labeled dialog, Escape closes, focus returns to Compare", async () => {
    get.mockResolvedValue(cmp());
    function Host() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Compare</button>
          {open && <CompareRunsDialog runs={[older, newer]} onClose={() => setOpen(false)} />}
        </>
      );
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ evalsDashboard }}>
          <Host />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const btn = screen.getByRole("button", { name: "Compare" });
    btn.focus();
    fireEvent.click(btn);
    const dlg = screen.getByRole("dialog", { name: /Compare runs/ });
    expect(dlg).toHaveAttribute("aria-modal", "true");
    expect(dlg).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(btn).toHaveFocus();
  });

  it("load error shows an alert", async () => {
    get.mockRejectedValue(new Error("x"));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the comparison.");
  });

  it("renders skills added/removed/version-change and strategy lines (AC-69)", async () => {
    get.mockResolvedValue(
      cmp({
        a: mkDetail({
          ...older,
          manifest: mkManifest({
            strategy: "single-pass",
            skills: ["s-keep", "s-gone"],
            skill_versions: [
              { id: "s-keep", name: "SQL rules", version: 1 },
              { id: "s-gone", name: "Old skill", version: 4 },
            ],
          }),
        }),
        b: mkDetail({
          ...newer,
          manifest: mkManifest({
            strategy: "map-reduce",
            skills: ["s-keep", "s-new"],
            skill_versions: [
              { id: "s-keep", name: "SQL rules", version: 2 },
              { id: "s-new", name: "New skill", version: 1 },
            ],
          }),
        }),
      }),
    );
    mount();
    expect(await screen.findByText("Strategy: single-pass → map-reduce")).toBeInTheDocument();
    expect(screen.getByText("Skill added: New skill")).toBeInTheDocument();
    expect(screen.getByText("Skill removed: Old skill")).toBeInTheDocument();
    expect(screen.getByText("Skill SQL rules: v1 → v2")).toBeInTheDocument();
  });
});
