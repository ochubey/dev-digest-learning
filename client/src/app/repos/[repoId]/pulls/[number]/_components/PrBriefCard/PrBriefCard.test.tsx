import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import brief from "../../../../../../../../messages/en/brief.json";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
    },
  };
});

import { ApiError } from "@/lib/api";
import type { BriefResponse } from "@/lib/hooks/brief";
import { PrBriefCard } from "./PrBriefCard";

const BRIEF: BriefResponse = {
  pr_id: "pr1",
  stale: false,
  summary: "Adds retry to the sync job.",
  intent: null,
  blast: null,
  risks: {
    risks: [
      {
        kind: "security",
        title: "Token logged",
        explanation: "The token is written to logs.",
        severity: "high",
        file_refs: ["src/auth.ts", "src/other.ts"],
      },
      {
        kind: "weird_kind",
        title: "Odd thing",
        explanation: "x",
        severity: "low",
        file_refs: ["src/z.ts"],
      },
    ],
  },
  review_focus: [
    { file: "src/b.ts", line: 20, reason: "second by file" },
    { file: "src/a.ts", line: 5, reason: "first by file" },
  ],
  meta: {
    generated_from_head_sha: "abc",
    generated_at: "2026-01-02T03:04:05.000Z",
    provider: "p",
    model: "m",
    schema_attempts: 1,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
    missing: [],
    sources: [],
    diff_stats: null,
    input: { estimated_tokens: 1, budget_tokens: 2, truncated: [], blast_degraded_reason: null },
    grounding: { dropped_risks: 0, dropped_refs: 0, dropped_focus: 0, adjusted_lines: 0, dropped_anchors: 0 },
  },
};

const withBrief = (over: Partial<BriefResponse>): BriefResponse => ({ ...BRIEF, ...over });

const onOpenInDiff = vi.fn();
const notifyInfo = vi.fn();
vi.mock("@/lib/toast", () => ({
  notify: { info: (...a: unknown[]) => notifyInfo(...a) },
}));

function renderCard(paths: string[] = ["src/a.ts", "src/auth.ts", "src/other.ts"]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief }}>
        <PrBriefCard prId="pr1" diffPaths={new Set(paths)} onOpenInDiff={onOpenInDiff} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const notFound = () => new ApiError("not found", 404);
const generateBtn = () => screen.findByRole("button", { name: "Generate brief" });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  onOpenInDiff.mockReset();
  notifyInfo.mockReset();
});
afterEach(cleanup);

describe("empty state", () => {
  it("shows a Generate brief button on 404 (AC-1)", async () => {
    get.mockRejectedValue(notFound());
    renderCard();
    expect(await generateBtn()).toBeEnabled();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("click triggers exactly one POST (AC-2)", async () => {
    get.mockRejectedValue(notFound());
    post.mockReturnValue(new Promise(() => {}));
    renderCard();
    fireEvent.click(await generateBtn());
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/pulls/pr1/brief");
  });

  it("pending: button disabled and wrapper aria-busy (AC-3)", async () => {
    get.mockRejectedValue(notFound());
    post.mockReturnValue(new Promise(() => {}));
    const { container } = renderCard();
    fireEvent.click(await generateBtn());
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(screen.getByRole("button", { name: /Generate brief/ })).toBeDisabled();
  });
});

describe("ready", () => {
  beforeEach(() => get.mockResolvedValue(BRIEF));

  it("renders summary, risks and focus (AC-4)", async () => {
    renderCard();
    expect(await screen.findByText("Adds retry to the sync job.")).toBeInTheDocument();
    expect(screen.getByText("Token logged")).toBeInTheDocument();
    expect(screen.getByText(/second by file/)).toBeInTheDocument();
  });

  it("risk shows its title and first file (AC-8)", async () => {
    renderCard();
    const item = (await screen.findByText("Token logged")).closest("li")!;
    expect(within(item).getByText("src/auth.ts")).toBeInTheDocument();
    expect(within(item).queryByText("src/other.ts")).toBeNull();
  });

  it("an unknown risk kind still renders with the fallback label (AC-80)", async () => {
    renderCard();
    const item = (await screen.findByText("Odd thing")).closest("li")!;
    expect(within(item).getByLabelText("Risk")).toBeInTheDocument();
  });

  it("focus renders `file:line - reason` in the given order (AC-9)", async () => {
    renderCard();
    await screen.findByText("Adds retry to the sync job.");
    const items = screen.getAllByTestId("focus-item").map((el) => el.textContent);
    expect(items).toEqual(["src/b.ts:20 - second by file", "src/a.ts:5 - first by file"]);
  });

  it("focus item opens the diff at its line; risk ref opens the file", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /src\/a\.ts:5/ }));
    expect(onOpenInDiff).toHaveBeenLastCalledWith("src/a.ts", 5);
    fireEvent.click(screen.getByRole("button", { name: "Open src/auth.ts" }));
    expect(onOpenInDiff).toHaveBeenLastCalledWith("src/auth.ts", null);
  });

  it("Regenerate in the header triggers a POST (AC-10, AC-30)", async () => {
    post.mockResolvedValue(BRIEF);
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it("renders model text as text, never HTML", async () => {
    get.mockResolvedValue(withBrief({ summary: "<img src=x onerror=alert(1)> <b>bold</b>" }));
    const { container } = renderCard();
    expect(await screen.findByText(/<b>bold<\/b>/)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });
});

describe("empty lists", () => {
  it("risks: [] shows noRisks (AC-11)", async () => {
    get.mockResolvedValue(withBrief({ risks: { risks: [] } }));
    renderCard();
    expect(await screen.findByText(brief.noRisks)).toBeInTheDocument();
  });

  it("review_focus: [] shows card.noFocus (AC-12)", async () => {
    get.mockResolvedValue(withBrief({ review_focus: [] }));
    renderCard();
    expect(await screen.findByText(brief.card.noFocus)).toBeInTheDocument();
  });
});

describe("diff unavailable", () => {
  const noDiff = (over: Partial<BriefResponse> = {}) =>
    withBrief({ risks: { risks: [] }, review_focus: [], meta: metaWith({ missing: ["diff"] }), ...over });

  it("shows risksNotAssessed once, instead of noRisks and noFocus", async () => {
    get.mockResolvedValue(noDiff());
    renderCard();
    expect(await screen.findAllByText(brief.card.risksNotAssessed)).toHaveLength(1);
    expect(screen.queryByText(brief.noRisks)).toBeNull();
    expect(screen.queryByText(brief.card.noFocus)).toBeNull();
    expect(screen.queryByText(brief.card.reviewFocus)).toBeNull();
  });

  it("hides Review focus entirely when diff is missing and focus is empty, even with risks (AC-12)", async () => {
    get.mockResolvedValue(
      noDiff({
        risks: {
          risks: [
            {
              kind: "security",
              title: "Caller breaks",
              explanation: "x",
              severity: "high",
              file_refs: ["src/caller.ts"],
            },
          ],
        },
      }),
    );
    renderCard();
    expect(await screen.findByText("Caller breaks")).toBeInTheDocument();
    expect(screen.queryByText(brief.card.reviewFocus)).toBeNull();
    expect(screen.queryByText(brief.card.noFocus)).toBeNull();
    expect(screen.queryByText(brief.card.risksNotAssessed)).toBeNull();
  });

  it("keeps the normal empty text when the diff was available", async () => {
    get.mockResolvedValue(withBrief({ risks: { risks: [] }, review_focus: [] }));
    renderCard();
    expect(await screen.findByText(brief.noRisks)).toBeInTheDocument();
    expect(screen.queryByText(brief.card.risksNotAssessed)).toBeNull();
    expect(screen.getByText(brief.card.reviewFocus)).toBeInTheDocument();
    expect(screen.getByText(brief.card.noFocus)).toBeInTheDocument();
  });
});

describe("notice slot", () => {
  it("renders directly under the header and missing note, before the stats", async () => {
    get.mockResolvedValue(withBrief({ meta: metaWith({ missing: ["intent"], diff_stats: STATS }) }));
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ brief }}>
          <PrBriefCard prId="pr1" diffPaths={new Set()} onOpenInDiff={onOpenInDiff} notice={<p data-testid="slot">hint</p>} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const slot = await screen.findByTestId("slot");
    const missing = screen.getByText(/Generated without/);
    const stats = screen.getByTestId("brief-stats");
    expect(missing.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("stale", () => {
  it("shows a status badge (AC-29)", async () => {
    get.mockResolvedValue(withBrief({ stale: true }));
    renderCard();
    const badge = await screen.findByRole("status");
    expect(badge).toHaveTextContent(brief.card.stale);
  });

  it("no badge when fresh", async () => {
    get.mockResolvedValue(BRIEF);
    renderCard();
    await screen.findByText("Adds retry to the sync job.");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("429", () => {
  const rateLimited = () => new ApiError("recent", 429, undefined, { retry_after: 7 });

  it("keeps the brief, shows seconds as a status, refetches exactly once (AC-32)", async () => {
    get.mockResolvedValue(BRIEF);
    post.mockRejectedValue(rateLimited());
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    const msg = await screen.findByText(/Try again in 7 seconds/);
    expect(msg.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText("Adds retry to the sync job.")).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("a refetch that 404s keeps the empty state with no 'ready' wording (AC-32)", async () => {
    get.mockRejectedValue(notFound());
    post.mockRejectedValue(rateLimited());
    renderCard();
    fireEvent.click(await generateBtn());
    await screen.findByText(/Try again in 7 seconds/);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await generateBtn()).toBeInTheDocument();
    expect(screen.queryByText(/ready/i)).toBeNull();
  });
});

const SERVER_502 = "Risk Brief model (Settings > Models > Risk Brief): X is not configured";

describe("502", () => {
  it("non-502 errors keep the generic card text", async () => {
    get.mockResolvedValue(BRIEF);
    post.mockRejectedValueOnce(new ApiError("kaboom", 500));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(brief.card.generateError);
  });

  it("shows an alert with Retry and keeps the previous brief (AC-34)", async () => {
    get.mockResolvedValue(BRIEF);
    post.mockRejectedValueOnce(new ApiError(SERVER_502, 502, undefined, { retry_after: 3 }));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(SERVER_502);
    expect(screen.getByText("Adds retry to the sync job.")).toBeInTheDocument();

    post.mockResolvedValueOnce(BRIEF);
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("load error", () => {
  it("non-404 GET failure shows an alert with Retry", async () => {
    get.mockRejectedValue(new ApiError("boom", 500));
    renderCard();
    // usePrBrief retries once for non-404 errors
    const alert = await screen.findByRole("alert", undefined, { timeout: 4000 });
    expect(alert).toHaveTextContent(brief.card.loadError);
  }, 10000);
});

describe("i18n (AC-54)", () => {
  it("renders every state without missing-message keys", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a));
    get.mockResolvedValue(withBrief({ stale: true, meta: { ...BRIEF.meta, missing: ["intent"] } }));
    renderCard();
    await screen.findByText("Adds retry to the sync job.");
    spy.mockRestore();
    expect(errors).toEqual([]);
    expect(document.body.textContent).not.toMatch(/card\.\w+/);
  });
});

const STATS = {
  files: 3,
  additions: 10,
  deletions: 4,
  by_role: { core: 2, tests: 1, wiring: 0, docs: 0, boilerplate: 0 },
};
const metaWith = (over: Partial<BriefResponse["meta"]>) => ({ ...BRIEF.meta, ...over });

describe("missing note", () => {
  it("missing note names intent and blast (AC-7)", async () => {
    get.mockResolvedValue(withBrief({ meta: metaWith({ missing: ["intent", "blast"] }) }));
    renderCard();
    const note = await screen.findByRole("status");
    expect(note).toHaveTextContent("Generated without: intent, blast radius");
  });
});

describe("stats and sources", () => {
  it("shows files, +a/-d, roles and source chips (AC-55)", async () => {
    get.mockResolvedValue(
      withBrief({
        meta: metaWith({
          diff_stats: STATS,
          sources: [
            { label: "README.md", status: "fetched" },
            { label: "#12", status: "unavailable" },
          ],
        }),
      }),
    );
    renderCard();
    const row = await screen.findByTestId("brief-stats");
    expect(row).toHaveTextContent("3 files");
    expect(row).toHaveTextContent("+10");
    expect(row).toHaveTextContent("-4");
    expect(row).toHaveTextContent("Core 2");
    expect(row).toHaveTextContent("Tests 1");
    expect(row).not.toHaveTextContent("Wiring");
    expect(row).toHaveTextContent("README.md (Fetched)");
    expect(row).toHaveTextContent("#12 (Not found)");
  });

  it("files: 0 renders an empty row; null hides it (AC-59)", async () => {
    get.mockResolvedValue(
      withBrief({
        meta: metaWith({ diff_stats: { ...STATS, files: 0, additions: 0, deletions: 0 } }),
      }),
    );
    renderCard();
    const row = await screen.findByTestId("brief-stats");
    expect(row).toBeEmptyDOMElement();
    cleanup();
    get.mockResolvedValue(BRIEF);
    renderCard();
    await screen.findByText("Adds retry to the sync job.");
    expect(screen.queryByTestId("brief-stats")).toBeNull();
  });

  it("renders the summary under its heading", async () => {
    get.mockResolvedValue(BRIEF);
    renderCard();
    expect(await screen.findByText("Summary")).toBeInTheDocument();
  });
});

describe("skeleton / regenerating / expand", () => {
  it("first generation shows the two-column skeleton (AC-52)", async () => {
    get.mockRejectedValue(notFound());
    post.mockReturnValue(new Promise(() => {}));
    renderCard();
    fireEvent.click(await generateBtn());
    expect(await screen.findByTestId("brief-skeleton")).toBeInTheDocument();
  });

  it("regeneration dims the previous brief and keeps it (AC-53)", async () => {
    get.mockResolvedValue(BRIEF);
    post.mockReturnValue(new Promise(() => {}));
    const { container } = renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    const busy = await waitFor(() => {
      const el = container.querySelector('[aria-busy="true"]') as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    expect(busy.style.opacity).toBe("0.5");
    expect(screen.getByText("Adds retry to the sync job.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: brief.card.regenerating })).toBeDisabled();
    expect(screen.queryByTestId("brief-skeleton")).toBeNull();
  });

  it("chevron toggles explanation and all refs with aria-expanded (AC-51)", async () => {
    get.mockResolvedValue(BRIEF);
    renderCard();
    const chev = await screen.findByRole("button", { name: "Show details: Token logged" });
    expect(chev).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("The token is written to logs.")).toBeNull();
    fireEvent.click(chev);
    expect(chev).toHaveAttribute("aria-expanded", "true");
    const region = document.getElementById(chev.getAttribute("aria-controls")!)!;
    expect(region).toHaveTextContent("The token is written to logs.");
    expect(within(region).getByRole("button", { name: "Open src/auth.ts" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Open src/other.ts" })).toBeInTheDocument();
    fireEvent.click(chev);
    expect(chev).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("The token is written to logs.")).toBeNull();
  });

  it("custom kind renders the generic icon and the text label (AC-80)", async () => {
    get.mockResolvedValue(
      withBrief({
        risks: {
          risks: [{ kind: "custom", title: "C", explanation: "e", severity: "medium", file_refs: [] }],
        },
      }),
    );
    renderCard();
    const item = (await screen.findByText("C")).closest("li")!;
    expect(within(item).getByLabelText("Risk")).toBeInTheDocument();
    expect(within(item).getByText("Medium")).toBeInTheDocument();
  });
});

describe("navigation", () => {
  beforeEach(() => get.mockResolvedValue(BRIEF));

  it("focus item name includes file:line and opens the diff (AC-35, AC-41)", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /src\/b\.ts:20/ }));
    expect(notifyInfo).toHaveBeenCalledWith(brief.card.notInDiff);
    cleanup();
    renderCard(["src/b.ts"]);
    fireEvent.click(await screen.findByRole("button", { name: /src\/b\.ts:20/ }));
    expect(onOpenInDiff).toHaveBeenCalledWith("src/b.ts", 20);
  });

  it("a ref outside the diff toasts and does not navigate (AC-42)", async () => {
    renderCard(["src/a.ts"]);
    fireEvent.click(await screen.findByRole("button", { name: "Open src/auth.ts" }));
    expect(notifyInfo).toHaveBeenCalledWith(brief.card.notInDiff);
    expect(onOpenInDiff).not.toHaveBeenCalled();
  });

  it("navigate does not toggle and the chevron does not navigate (AC-73)", async () => {
    renderCard();
    const open = await screen.findByRole("button", { name: "Open src/auth.ts" });
    const chev = screen.getByRole("button", { name: "Show details: Token logged" });
    fireEvent.click(open);
    expect(chev).toHaveAttribute("aria-expanded", "false");
    expect(onOpenInDiff).toHaveBeenCalledTimes(1);
    onOpenInDiff.mockClear();
    fireEvent.click(chev);
    expect(onOpenInDiff).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  describe("keyboard activation (AC-73)", () => {
    // @testing-library/user-event is not a dependency and jsdom does not turn Enter/Space on a
    // native <button> into a click. This helper mirrors the browser: Enter fires click on keydown,
    // Space on keyup, always on the focused element. Controls must be native, separate buttons.
    function press(key: "Enter" | " ") {
      const el = document.activeElement as HTMLElement;
      fireEvent.keyDown(el, { key });
      if (key === "Enter") fireEvent.click(el);
      fireEvent.keyUp(el, { key });
      if (key === " ") fireEvent.click(el);
    }

    it("navigate button: Enter and Space open the diff once each and never toggle", async () => {
      renderCard();
      const open = await screen.findByRole("button", { name: "Open src/auth.ts" });
      const chev = screen.getByRole("button", { name: "Show details: Token logged" });
      expect(open.tagName).toBe("BUTTON");
      expect(chev.contains(open) || open.contains(chev)).toBe(false);
      open.focus();
      expect(document.activeElement).toBe(open);
      press("Enter");
      expect(onOpenInDiff).toHaveBeenCalledTimes(1);
      expect(onOpenInDiff).toHaveBeenLastCalledWith("src/auth.ts", null);
      press(" ");
      expect(onOpenInDiff).toHaveBeenCalledTimes(2);
      expect(chev).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("The token is written to logs.")).toBeNull();
    });

    it("chevron: Enter and Space toggle expansion and never navigate", async () => {
      renderCard();
      const chev = await screen.findByRole("button", { name: "Show details: Token logged" });
      expect(chev.tagName).toBe("BUTTON");
      chev.focus();
      expect(document.activeElement).toBe(chev);
      press("Enter");
      expect(chev).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("The token is written to logs.")).toBeInTheDocument();
      press(" ");
      expect(chev).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("The token is written to logs.")).toBeNull();
      expect(onOpenInDiff).not.toHaveBeenCalled();
      expect(notifyInfo).not.toHaveBeenCalled();
    });
  });

  it("line_adjusted focus items show the hint", async () => {
    get.mockResolvedValue(
      withBrief({ review_focus: [{ file: "src/a.ts", line: 5, reason: "r", line_adjusted: true }] }),
    );
    renderCard();
    expect(await screen.findByText(brief.card.lineAdjusted)).toBeInTheDocument();
  });
});

const ANCHOR_FILE = "src/middleware/ratelimit.ts";
const anchored = (start: number, end: number): Partial<BriefResponse> => ({
  risks: {
    risks: [
      {
        kind: "perf",
        title: "Unbounded loop",
        explanation: "e",
        severity: "medium",
        file_refs: [ANCHOR_FILE, "src/other.ts"],
        anchor: { file: ANCHOR_FILE, start_line: start, end_line: end },
      },
    ],
  },
});

describe("risk anchor", () => {
  it("labels a range, a single line and no anchor (AC-99)", async () => {
    get.mockResolvedValue(withBrief(anchored(12, 18)));
    renderCard([ANCHOR_FILE]);
    expect(await screen.findByRole("button", { name: `Open ${ANCHOR_FILE}:12-18` })).toHaveTextContent(
      `${ANCHOR_FILE}:12-18`,
    );
    cleanup();
    get.mockResolvedValue(withBrief(anchored(12, 12)));
    renderCard([ANCHOR_FILE]);
    expect(await screen.findByRole("button", { name: `Open ${ANCHOR_FILE}:12` })).toBeInTheDocument();
    cleanup();
    get.mockResolvedValue(BRIEF);
    renderCard();
    expect(await screen.findByRole("button", { name: "Open src/auth.ts" })).toHaveTextContent(/^src\/auth\.ts$/);
  });

  it("anchor ref opens its start line; another ref of the same risk opens with null (AC-100)", async () => {
    get.mockResolvedValue(withBrief(anchored(12, 18)));
    renderCard([ANCHOR_FILE, "src/other.ts"]);
    fireEvent.click(await screen.findByRole("button", { name: `Open ${ANCHOR_FILE}:12-18` }));
    expect(onOpenInDiff).toHaveBeenLastCalledWith(ANCHOR_FILE, 12);
    fireEvent.click(screen.getByRole("button", { name: "Show details: Unbounded loop" }));
    fireEvent.click(screen.getByRole("button", { name: "Open src/other.ts" }));
    expect(onOpenInDiff).toHaveBeenLastCalledWith("src/other.ts", null);
    expect(screen.getAllByRole("button", { name: `Open ${ANCHOR_FILE}:12-18` })).toHaveLength(1);
  });

  it("an anchor file outside the diff toasts and does not navigate (AC-42)", async () => {
    get.mockResolvedValue(withBrief(anchored(12, 18)));
    renderCard(["src/a.ts"]);
    fireEvent.click(await screen.findByRole("button", { name: `Open ${ANCHOR_FILE}:12-18` }));
    expect(notifyInfo).toHaveBeenCalledWith(brief.card.notInDiff);
    expect(onOpenInDiff).not.toHaveBeenCalled();
  });

  it("a pre-revision brief has no :line suffix on any risk label (AC-97)", async () => {
    get.mockResolvedValue(BRIEF);
    renderCard();
    await screen.findByText("Token logged");
    for (const b of screen.getAllByRole("button", { name: /^Open / })) {
      expect(b.textContent).not.toMatch(/:\d/);
    }
  });
});

describe("cost and tokens", () => {
  const costMeta = (over: Partial<BriefResponse["meta"]> = {}) =>
    metaWith({ cost_usd: 0.0142, tokens_in: 8150, tokens_out: 1312, ...over });
  const note = () => screen.findByRole("note", { name: /Generation cost/ });

  it("shows cost and in-to-out tokens with an accessible name and title (AC-101..AC-103, AC-106)", async () => {
    get.mockResolvedValue(withBrief({ meta: costMeta() }));
    renderCard();
    const el = await note();
    expect(el).toHaveTextContent("$0.014");
    expect(el).toHaveTextContent("8.2K\u21921.3K");
    const full = "Generation cost and tokens: cost $0.014, input tokens 8,150, output tokens 1,312";
    expect(el).toHaveAttribute("aria-label", full);
    expect(el).toHaveAttribute("title", full);
  });

  it("cost null shows tokens only", async () => {
    get.mockResolvedValue(withBrief({ meta: costMeta({ cost_usd: null }) }));
    renderCard();
    const el = await note();
    expect(el).toHaveTextContent("8.2K\u21921.3K");
    expect(el).not.toHaveTextContent("$");
    expect(el).toHaveAttribute("title", "Generation cost and tokens: input tokens 8,150, output tokens 1,312");
  });

  it("tokens_out null shows `8.2K in` and omits the output part", async () => {
    get.mockResolvedValue(withBrief({ meta: costMeta({ tokens_out: null }) }));
    renderCard();
    const el = await note();
    expect(el).toHaveTextContent("$0.014");
    expect(el).toHaveTextContent("8.2K in");
    expect(el).not.toHaveTextContent("\u2192");
    expect(el).toHaveAttribute("title", "Generation cost and tokens: cost $0.014, input tokens 8,150");
  });

  it("tokens_in null shows `1.3K out`", async () => {
    get.mockResolvedValue(withBrief({ meta: costMeta({ tokens_in: null }) }));
    renderCard();
    expect(await note()).toHaveTextContent("1.3K out");
  });

  it("all null renders no element (AC-104)", async () => {
    get.mockResolvedValue(BRIEF);
    renderCard();
    await screen.findByText("Adds retry to the sync job.");
    expect(screen.queryByRole("note", { name: /Generation cost/ })).toBeNull();
  });

  it("stays visible when stale (AC-105)", async () => {
    get.mockResolvedValue(withBrief({ stale: true, meta: costMeta() }));
    renderCard();
    expect(await note()).toBeInTheDocument();
  });

  it("stays dimmed while regenerating, then shows the new values (AC-107)", async () => {
    get.mockResolvedValue(withBrief({ meta: costMeta() }));
    let resolve!: (b: BriefResponse) => void;
    post.mockReturnValue(new Promise<BriefResponse>((r) => (resolve = r)));
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ brief }}>
          <PrBriefCard prId="pr1" diffPaths={new Set()} onOpenInDiff={onOpenInDiff} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate" }));
    const busy = await waitFor(() => {
      const el = container.querySelector('[aria-busy="true"]') as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    expect(busy.style.opacity).toBe("0.5");
    expect(busy).toContainElement(await note());
    expect(await note()).toHaveTextContent("8.2K\u21921.3K");
    const next = withBrief({ meta: costMeta({ cost_usd: 0.5, tokens_in: 20000, tokens_out: 900 }) });
    resolve(next);
    await waitFor(async () => expect(await note()).toHaveTextContent("$0.500"));
    expect(await note()).toHaveTextContent("20.0K\u2192900");
  });
});
