import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { AgentStats } from "@devdigest/shared";
import sample from "@/test/fixtures/agent-performance.sample.json";
import { renderWithIntl } from "@/components/agent-performance/test-utils";
import { AgentTable } from "./AgentTable";

const AGENTS = sample.agents as unknown as AgentStats[];
const PERIOD = sample.period;

const fetchMock = vi.fn();
afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const mount = (agents: AgentStats[] = AGENTS) => {
  vi.stubGlobal("fetch", fetchMock);
  return renderWithIntl(<AgentTable agents={agents} period={PERIOD} />);
};
/** Agent names in body-row order. */
const order = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).queryByTestId("agent-name")?.textContent)
    .filter((x): x is string => !!x);
const header = (name: string) => screen.getByRole("columnheader", { name: new RegExp(`^${name}`) });
const sortBtn = (name: string) => within(header(name)).getByRole("button", { name });

describe("AgentTable columns (AC-42)", () => {
  it("has the seven headings, none empty", () => {
    mount();
    const heads = screen.getAllByRole("columnheader");
    expect(heads.map((h) => h.textContent?.replace("Estimate", "").trim())).toEqual([
      "Agent",
      "Runs",
      "Avg cost",
      "Avg duration",
      "Accept rate",
      "Last run",
      "View",
    ]);
    for (const h of heads) expect((h.textContent ?? "").trim()).not.toBe("");
  });

  it("renders one row per agent, also those without runs", () => {
    mount();
    expect(order()).toEqual(["Security Reviewer", "Perf Bot", "Docs Agent", "Never Run"]);
  });

  it("marks the cost column header as an estimate (AC-58)", () => {
    mount();
    expect(within(header("Avg cost")).getByRole("button", { name: "Estimate" })).toBeInTheDocument();
  });
});

describe("AgentTable cells (AC-43..45, AC-50, AC-51, AC-65)", () => {
  it("shows cost, duration and accept rate of a row with runs", () => {
    mount();
    const row = screen.getByText("Security Reviewer").closest("tr")!;
    expect(within(row).getByText("$0.0025")).toBeInTheDocument();
    expect(within(row).getByText("14.2 s")).toBeInTheDocument();
    expect(within(row).getByText("60%")).toBeInTheDocument();
    expect(within(row).getByText("6/10")).toBeInTheDocument();
    const perf = screen.getByText("Perf Bot").closest("tr")!;
    expect(within(perf).getByText("1 m 05 s")).toBeInTheDocument();
    expect(within(perf).getByText("low sample")).toBeInTheDocument();
  });

  it("zero-run row: Runs 0, dashes, n/a with 0 decisions", () => {
    mount();
    const row = screen.getByText("Docs Agent").closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent(/^0$/);
    expect(cells[2]).toHaveTextContent(/^—$/);
    expect(cells[3]).toHaveTextContent(/^—$/);
    expect(cells[4]).toHaveTextContent("n/a · 0 decisions");
  });

  it("renders the three last-run cases differently", () => {
    mount();
    const cell = (name: string) => within(screen.getByText(name).closest("tr")!).getAllByRole("cell")[5]!.textContent;
    const texts = [cell("Security Reviewer"), cell("Docs Agent"), cell("Never Run")];
    expect(texts[0]).toBe("2026-10-18 09:30 UTC");
    expect(texts[1]).toBe("No runs in period · last 2026-08-01 08:00 UTC");
    expect(texts[2]).toBe("Never run");
    expect(new Set(texts).size).toBe(3);
  });
});

describe("AgentTable sorting (AC-46..49)", () => {
  it("defaults to Runs descending with ties by name and aria-sort", () => {
    mount();
    expect(order()).toEqual(["Security Reviewer", "Perf Bot", "Docs Agent", "Never Run"]);
    expect(header("Runs")).toHaveAttribute("aria-sort", "descending");
    expect(header("Agent")).toHaveAttribute("aria-sort", "none");
  });

  it("toggles the direction on a repeated activation", () => {
    mount();
    fireEvent.click(sortBtn("Runs"));
    expect(header("Runs")).toHaveAttribute("aria-sort", "ascending");
    expect(order()).toEqual(["Docs Agent", "Never Run", "Perf Bot", "Security Reviewer"]);
  });

  it("sorts by agent name ascending first, then descending", () => {
    mount();
    fireEvent.click(sortBtn("Agent"));
    expect(header("Agent")).toHaveAttribute("aria-sort", "ascending");
    expect(order()).toEqual(["Docs Agent", "Never Run", "Perf Bot", "Security Reviewer"]);
    fireEvent.click(sortBtn("Agent"));
    expect(order()).toEqual(["Security Reviewer", "Perf Bot", "Never Run", "Docs Agent"]);
  });

  it("puts null averages last in both directions", () => {
    mount();
    fireEvent.click(sortBtn("Avg cost"));
    expect(order().slice(0, 2)).toEqual(["Security Reviewer", "Perf Bot"]);
    expect(order().slice(2)).toEqual(["Docs Agent", "Never Run"]);
    fireEvent.click(sortBtn("Avg cost"));
    expect(order().slice(0, 2)).toEqual(["Perf Bot", "Security Reviewer"]);
    expect(order().slice(2)).toEqual(["Docs Agent", "Never Run"]);
  });

  it("accept rate: enough decisions first, then low sample, then n/a, never by the low-sample rate", () => {
    mount();
    fireEvent.click(sortBtn("Accept rate"));
    expect(order()).toEqual(["Security Reviewer", "Perf Bot", "Docs Agent", "Never Run"]);
    fireEvent.click(sortBtn("Accept rate"));
    expect(header("Accept rate")).toHaveAttribute("aria-sort", "ascending");
    expect(order()).toEqual(["Security Reviewer", "Perf Bot", "Docs Agent", "Never Run"]);
  });

  it("announces the sort in a polite status line", () => {
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("Sorted by runs, descending");
  });
});

/**
 * jsdom does not turn Enter/Space on a <button> into a click, so mirror the browser: Enter
 * activates on keydown, Space on keyup, unless the page prevented the default. This also
 * proves the controls are native buttons whose handler is the click one.
 */
function press(el: HTMLElement, key: "Enter" | " ") {
  expect(el.tagName).toBe("BUTTON");
  expect(el).toHaveAttribute("type", "button");
  const down = fireEvent.keyDown(el, { key });
  if (key === "Enter" && down) fireEvent.click(el);
  if (key === " ") {
    const up = fireEvent.keyUp(el, { key });
    if (down && up) fireEvent.click(el);
  }
}

describe("AgentTable keyboard activation (AC-47)", () => {
  it.each(["Enter", " "] as const)("sort header buttons activate with %j", (key) => {
    mount();
    press(sortBtn("Runs"), key);
    expect(header("Runs")).toHaveAttribute("aria-sort", "ascending");
    press(sortBtn("Agent"), key);
    expect(header("Agent")).toHaveAttribute("aria-sort", "ascending");
    expect(order()).toEqual(["Docs Agent", "Never Run", "Perf Bot", "Security Reviewer"]);
  });

  it.each(["Enter", " "] as const)("the row expand button toggles with %j", (key) => {
    mount();
    const btn = screen.getByRole("button", { name: /Security Reviewer/ });
    press(btn, key);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    press(btn, key);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });
});

describe("AgentTable expand and View (AC-52..54)", () => {
  it("expand button: aria-expanded, name contains the agent, details from loaded data, no request", () => {
    mount();
    const btn = screen.getByRole("button", { name: /Security Reviewer/ });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const region = document.getElementById(btn.getAttribute("aria-controls")!)!;
    const text = region.textContent ?? "";
    expect(text).toContain("Accepted6");
    expect(text).toContain("Dismissed4");
    expect(text).toContain("Pending2");
    expect(text).toContain("Excluded runs2");
    expect(text).toContain("Runs with cost5");
    expect(text).toContain("Runs without cost1");
    expect(text).toContain("Total costEstimate$0.01");
    expect(text).toContain("Critical2");
    expect(text).toContain("Warning7");
    expect(text).toContain("Suggestion3");
    expect(within(region).getByRole("button", { name: "Estimate" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("View links to the Stats tab with the exact response instants", () => {
    mount();
    const row = screen.getByText("Security Reviewer").closest("tr")!;
    const link = within(row).getByRole("link", { name: /View/ });
    const u = new URL(link.getAttribute("href")!, "http://x");
    expect(u.pathname).toBe("/agents/00000000-0000-4000-8000-000000000001");
    expect(u.searchParams.get("tab")).toBe("stats");
    expect(u.searchParams.get("from")).toBe(PERIOD.from);
    expect(u.searchParams.get("to")).toBe(PERIOD.to);
  });
});

describe("AgentTable plain text (AC-75)", () => {
  it("renders a hostile name literally", () => {
    const evil = { ...AGENTS[0]!, agent_name: "<img src=x onerror=alert(1)>**bold**" };
    const { container } = mount([evil]);
    expect(screen.getByTestId("agent-name")).toHaveTextContent("<img src=x onerror=alert(1)>**bold**");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });
});
