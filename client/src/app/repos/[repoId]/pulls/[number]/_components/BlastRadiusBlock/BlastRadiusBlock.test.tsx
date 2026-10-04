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

const repoIntel = { mutate: vi.fn(), updatedAt: "t0", isError: false };

vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate: repoIntel.mutate, isError: repoIntel.isError }),
  useRepoIntelStatus: () => ({ data: { updatedAt: repoIntel.updatedAt } }),
}));

import { BlastRadiusBlock } from "./BlastRadiusBlock";

beforeEach(() => {
  state.data = undefined;
  state.isLoading = false;
  state.error = null;
  state.refetch = vi.fn();
  repoIntel.mutate = vi.fn();
  repoIntel.updatedAt = "t0";
  repoIntel.isError = false;
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

type BlockProps = { repoId?: string | null; repoFullName?: string | null; headSha?: string | null };

const tree = (props: BlockProps) => (
  <NextIntlClientProvider locale="en" messages={{ blast }}>
    <BlastRadiusBlock prId="pr1" {...props} />
  </NextIntlClientProvider>
);

function renderBlock(
  props: BlockProps = { repoId: "repo1", repoFullName: "o/r", headSha: "abc123" },
) {
  const view = render(tree(props));
  return { ...view, rerenderBlock: () => view.rerender(tree(props)) };
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

  describe("tree", () => {
    const TWO: BlastData = {
      ...DATA,
      downstream: [
        DATA.downstream[0]!,
        {
          symbol: "bar",
          callers: [{ name: "other", file: "src/o.ts", line: 3 }],
          endpoints_affected: ["POST /y"],
          crons_affected: [],
        },
      ],
    };

    it("expands the first symbol and collapses the rest", () => {
      state.data = TWO;
      renderBlock();
      const [first, second] = screen.getAllByRole("button", { expanded: undefined });
      expect(first).toHaveAttribute("aria-expanded", "true");
      expect(second).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("src/r.ts:7")).toBeInTheDocument();
      expect(screen.queryByText("src/o.ts:3")).not.toBeInTheDocument();
    });

    it("toggles a symbol open and closed", () => {
      state.data = TWO;
      renderBlock();
      const second = screen.getAllByRole("button")[1]!;
      fireEvent.click(second);
      expect(second).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("src/o.ts:3")).toBeInTheDocument();
      expect(screen.getByText("POST /y")).toBeInTheDocument();
      fireEvent.click(second);
      expect(screen.queryByText("src/o.ts:3")).not.toBeInTheDocument();
    });

    it("keeps the caller count visible while collapsed", () => {
      state.data = TWO;
      renderBlock();
      expect(screen.getAllByText("1 callers")).toHaveLength(2);
    });
  });

  describe("resync", () => {
    const degraded = (reason: string): BlastData => ({ ...DATA, degraded: true, reason });

    it("offers a resync for a partial index", () => {
      state.data = degraded("index_partial");
      renderBlock();
      expect(screen.getByRole("button", { name: blast.degraded.resync })).toBeInTheDocument();
    });

    it("does not offer a resync when it cannot help or repoId is unknown", () => {
      state.data = degraded("flag_off");
      renderBlock();
      expect(screen.queryByRole("button", { name: blast.degraded.resync })).not.toBeInTheDocument();
      cleanup();
      state.data = degraded("index_partial");
      renderBlock({ repoFullName: "o/r", headSha: "abc123" });
      expect(screen.queryByRole("button", { name: blast.degraded.resync })).not.toBeInTheDocument();
    });

    it("does not offer a resync when the index is fine", () => {
      state.data = DATA;
      renderBlock();
      expect(screen.queryByRole("button", { name: blast.degraded.resync })).not.toBeInTheDocument();
    });

    it("starts the resync and refetches once the index state advances", () => {
      state.data = degraded("index_partial");
      const { rerenderBlock } = renderBlock();
      fireEvent.click(screen.getByRole("button", { name: blast.degraded.resync }));
      expect(repoIntel.mutate).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: blast.degraded.resyncing })).toBeInTheDocument();

      rerenderBlock();
      expect(state.refetch).not.toHaveBeenCalled();

      repoIntel.updatedAt = "t1";
      rerenderBlock();
      expect(state.refetch).toHaveBeenCalledTimes(1);
    });

    it("shows an error when the resync request fails", () => {
      state.data = degraded("index_partial");
      repoIntel.isError = true;
      renderBlock();
      expect(screen.getByRole("alert")).toHaveTextContent(blast.degraded.resyncFailed);
    });
  });
});
