import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import blast from "../../../../../../../../messages/en/blast.json";

type BlastData = {
  changed_symbols: { name: string; file: string; kind: string }[];
  downstream: {
    symbol: string;
    callers: { name: string; file: string; line: number }[];
    endpoints_affected: string[];
    crons_affected: string[];
  }[];
  summary: string;
  degraded: boolean;
  reason: string | null;
};

const state: {
  data: BlastData | undefined;
  isLoading: boolean;
  error: unknown;
  refetch: ReturnType<typeof vi.fn>;
} = { data: undefined, isLoading: false, error: null, refetch: vi.fn() };

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: () => ({
    data: state.data,
    isLoading: state.isLoading,
    error: state.error,
    refetch: state.refetch,
  }),
}));

import { BlastRadiusBlock } from "./BlastRadiusBlock";

beforeEach(() => {
  state.data = undefined;
  state.isLoading = false;
  state.error = null;
  state.refetch = vi.fn();
});
afterEach(cleanup);

const DATA: BlastData = {
  changed_symbols: [{ name: "foo", file: "src/a.ts", kind: "function" }],
  downstream: [
    {
      symbol: "foo",
      callers: [{ name: "handler", file: "src/r.ts", line: 7 }],
      endpoints_affected: ["GET /x"],
      crons_affected: ["daily"],
    },
  ],
  summary: "s",
  degraded: false,
  reason: null,
};

function renderBlock(props: { repoFullName?: string | null; headSha?: string | null } = {
  repoFullName: "o/r",
  headSha: "abc123",
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast }}>
      <BlastRadiusBlock prId="pr1" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("BlastRadiusBlock", () => {
  it("shows a skeleton while loading", () => {
    state.isLoading = true;
    renderBlock();
    expect(screen.getByText(blast.title)).toBeInTheDocument();
    expect(screen.queryByTestId("blast-stats")).not.toBeInTheDocument();
  });

  it("renders the error state with Retry", () => {
    state.error = new Error("boom");
    renderBlock();
    expect(screen.getByText(blast.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it("renders stats, symbol, caller, endpoint and cron chips", () => {
    state.data = DATA;
    renderBlock();
    expect(screen.getByTestId("blast-stats")).toHaveTextContent("1symbols");
    expect(screen.getByTestId("blast-stats")).toHaveTextContent("1callers");
    expect(screen.getByText("foo")).toBeInTheDocument();
    expect(screen.getByText("1 callers")).toBeInTheDocument();
    expect(screen.getByTestId("blast-endpoint")).toHaveTextContent("GET /x");
    expect(screen.getByTestId("blast-cron")).toHaveTextContent("daily");
  });

  it("links callers to the GitHub blob at head sha and line", () => {
    state.data = DATA;
    renderBlock();
    const link = screen.getByRole("link", { name: "src/r.ts:7" });
    expect(link).toHaveAttribute("href", "https://github.com/o/r/blob/abc123/src/r.ts#L7");
  });

  it("renders plain text instead of a link when repo/sha are unknown", () => {
    state.data = DATA;
    renderBlock({ repoFullName: null, headSha: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("src/r.ts:7")).toBeInTheDocument();
  });

  it("shows the no-downstream message when symbols have no callers", () => {
    state.data = {
      ...DATA,
      downstream: [{ symbol: "foo", callers: [], endpoints_affected: [], crons_affected: [] }],
    };
    renderBlock();
    expect(screen.getByTestId("blast-no-downstream")).toHaveTextContent(
      "1 changed symbol(s), no downstream callers found.",
    );
    expect(screen.getByText(blast.noCallers)).toBeInTheDocument();
  });

  it("shows the empty state when there are no changed symbols", () => {
    state.data = { ...DATA, changed_symbols: [], downstream: [] };
    renderBlock();
    expect(screen.getByText(blast.empty)).toBeInTheDocument();
  });

  it("shows a reason-specific degraded notice without crashing", () => {
    state.data = { ...DATA, degraded: true, reason: "index_partial" };
    renderBlock();
    expect(screen.getByTestId("blast-degraded")).toHaveTextContent(blast.degraded.index_partial);
    expect(screen.getByText("foo")).toBeInTheDocument();
  });

  it("shows the degraded notice (not the empty state) for a degraded empty result", () => {
    state.data = { ...DATA, changed_symbols: [], downstream: [], degraded: true, reason: "no_data" };
    renderBlock();
    expect(screen.getByTestId("blast-degraded")).toHaveTextContent(blast.degraded.no_data);
    expect(screen.queryByText(blast.empty)).not.toBeInTheDocument();
  });
});
