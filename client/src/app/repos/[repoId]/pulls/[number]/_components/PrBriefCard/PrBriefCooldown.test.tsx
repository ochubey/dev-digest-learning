import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import brief from "../../../../../../../../messages/en/brief.json";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: { ...actual.api, get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  };
});
const notifyError = vi.fn();
vi.mock("@/lib/toast", async () => {
  const actual = await vi.importActual<typeof import("@/lib/toast")>("@/lib/toast");
  return { ...actual, notify: { info: vi.fn(), error: (...a: unknown[]) => notifyError(...a) } };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
// Live intent differs from the brief snapshot (null), so the inputs-changed hint renders.
vi.mock("@/lib/hooks/reviews", () => ({
  useIntent: () => ({
    isPending: false,
    isFetching: false,
    error: null,
    data: { summary: "x", in_scope: [], out_of_scope: [] },
  }),
}));
vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: () => ({ isPending: false, isFetching: false, error: null, data: null }),
}));

import { ApiError } from "@/lib/api";
import { Providers } from "@/lib/providers";
import type { BriefResponse } from "@/lib/hooks/brief";
import { PrBriefCard } from "./PrBriefCard";
import { InputsChangedHint } from "./InputsChangedHint";

const BRIEF = {
  pr_id: "pr1",
  stale: false,
  summary: "Adds retry to the sync job.",
  intent: null,
  blast: null,
  risks: { risks: [] },
  review_focus: [],
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
} as unknown as BriefResponse;

const limited = (n: number) => new ApiError("recent", 429, undefined, { retry_after: n });

function Card({ withHint = false }: { withHint?: boolean }) {
  return (
    <PrBriefCard
      prId="pr1"
      diffPaths={new Set()}
      onOpenInDiff={() => {}}
      notice={withHint ? <InputsChangedHint prId="pr1" brief={BRIEF} /> : undefined}
    />
  );
}

function setup(ui: React.ReactElement, real = false) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrap = (el: React.ReactElement) => (
    <NextIntlClientProvider locale="en" messages={{ brief }}>
      {real ? <Providers>{el}</Providers> : <QueryClientProvider client={qc}>{el}</QueryClientProvider>}
    </NextIntlClientProvider>
  );
  const utils = render(wrap(ui));
  return { ...utils, qc };
}

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
const tickSec = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
const regenerate = () => screen.getAllByRole("button", { name: "Regenerate" });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  get.mockReset();
  post.mockReset();
  notifyError.mockReset();
  get.mockImplementation((path: string) =>
    path.endsWith("/brief") ? Promise.resolve(BRIEF) : Promise.resolve([]),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("429 cooldown", () => {
  it("counts down 3,2,1 then the notice goes and Regenerate is enabled again", async () => {
    post.mockRejectedValue(limited(3));
    setup(<Card />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await flush();
    expect(screen.getByText("Generation was started recently. Try again in 3 seconds.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
    await tickSec();
    expect(screen.getByText(/Try again in 2 seconds/)).toBeInTheDocument();
    await tickSec();
    expect(screen.getByText(/Try again in 1 second\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
    await tickSec();
    expect(screen.queryByText(/Try again in/)).toBeNull();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled();
  });

  it("keeps a fixed status label and hides the ticking number from assistive tech", async () => {
    post.mockRejectedValue(limited(3));
    setup(<Card />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await flush();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(brief.card.rateLimitedLabel);
    expect(screen.getByText(/Try again in 3 seconds/)).toHaveAttribute("aria-hidden", "true");
    await tickSec();
    expect(status).toHaveTextContent(brief.card.rateLimitedLabel);
  });

  it("disables the empty-state Generate button during the cooldown", async () => {
    get.mockRejectedValue(new ApiError("nf", 404));
    post.mockRejectedValue(limited(2));
    setup(<Card />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    await flush();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeDisabled();
    await tickSec();
    await tickSec();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeEnabled();
  });

  it("disables both the header and the hint Regenerate when either one hit the limit", async () => {
    post.mockRejectedValue(limited(2));
    setup(<Card withHint />);
    await flush();
    expect(regenerate()).toHaveLength(2);
    const [header, hint] = regenerate();
    fireEvent.click(hint!);
    await flush();
    expect(header).toBeDisabled();
    expect(hint).toBeDisabled();
    // One shared notice, not one per component.
    expect(screen.getAllByText(/Try again in 2 seconds/)).toHaveLength(1);
    await tickSec();
    await tickSec();
    expect(regenerate().every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("a remount during the cooldown keeps the remaining time", async () => {
    post.mockRejectedValue(limited(5));
    const { unmount, qc } = setup(<Card />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await flush();
    await tickSec();
    await tickSec();
    unmount();
    render(
      <NextIntlClientProvider locale="en" messages={{ brief }}>
        <QueryClientProvider client={qc}>
          <Card />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
    await flush();
    expect(screen.getByText(/Try again in 3 seconds/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
  });
});

describe("cooldown scope (AC-111)", () => {
  it("a 429 for PR A does not affect a card for PR B", async () => {
    post.mockRejectedValue(limited(30));
    const { qc } = setup(
      <PrBriefCard prId="prA" diffPaths={new Set()} onOpenInDiff={() => {}} />,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await flush();
    expect(screen.getByText(/Try again in 30 seconds/)).toBeInTheDocument();
    cleanup();
    render(
      <NextIntlClientProvider locale="en" messages={{ brief }}>
        <QueryClientProvider client={qc}>
          <PrBriefCard prId="prB" diffPaths={new Set()} onOpenInDiff={() => {}} />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
    await flush();
    expect(screen.queryByText(/Try again in/)).toBeNull();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled();
    cleanup();
    render(
      <NextIntlClientProvider locale="en" messages={{ brief }}>
        <QueryClientProvider client={qc}>
          <PrBriefCard prId="prA" diffPaths={new Set()} onOpenInDiff={() => {}} />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
    await flush();
    expect(screen.getByText(/Try again in/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
  });

  it("the empty-state Generate button of PR B stays enabled while PR A is cooling", async () => {
    get.mockRejectedValue(new ApiError("nf", 404));
    post.mockRejectedValue(limited(30));
    const { qc } = setup(
      <PrBriefCard prId="prA" diffPaths={new Set()} onOpenInDiff={() => {}} />,
    );
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    await flush();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeDisabled();
    cleanup();
    render(
      <NextIntlClientProvider locale="en" messages={{ brief }}>
        <QueryClientProvider client={qc}>
          <PrBriefCard prId="prB" diffPaths={new Set()} onOpenInDiff={() => {}} />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
    await flush();
    expect(screen.queryByText(/Try again in/)).toBeNull();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeEnabled();
  });
});

describe("global toast", () => {
  it("is not shown for a brief-generation 429", async () => {
    post.mockRejectedValue(limited(3));
    setup(<Card />, true);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await flush();
    expect(screen.getByText(/Try again in 3 seconds/)).toBeInTheDocument();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("is still shown for a 502", async () => {
    post.mockRejectedValue(new ApiError("model not configured", 502));
    setup(<Card />, true);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    await flush();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(notifyError).toHaveBeenCalledWith("model not configured");
  });
});
