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

type HistoryData = {
  history: {
    pr_number: number;
    title: string;
    merged_at: string;
    author: string;
    files_overlap: string[];
    notes: string;
  }[];
};
const prior: { data: HistoryData | undefined; isLoading: boolean; error: unknown } = {
  data: { history: [] },
  isLoading: false,
  error: null,
};

vi.mock("@/lib/hooks/blast", () => ({
  useBlastRadius: () => ({
    data: state.data,
    isLoading: state.isLoading,
    error: state.error,
    refetch: state.refetch,
  }),
  usePrHistory: () => ({ data: prior.data, isLoading: prior.isLoading, error: prior.error }),
}));

const repoIntel = { mutate: vi.fn(), updatedAt: "t0", isError: false };

vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate: repoIntel.mutate, isError: repoIntel.isError }),
  useRepoIntelStatus: () => ({ data: { updatedAt: repoIntel.updatedAt } }),
}));

import { BlastRadiusBlock } from "./BlastRadiusBlock";
import { SYMBOLS_INITIAL } from "./constants";

beforeEach(() => {
  state.data = undefined;
  state.isLoading = false;
  state.error = null;
  state.refetch = vi.fn();
  repoIntel.mutate = vi.fn();
  repoIntel.updatedAt = "t0";
  repoIntel.isError = false;
  prior.data = { history: [] };
  prior.isLoading = false;
  prior.error = null;
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
    // the symbol is summarised on one collapsed line, not rendered as a "0 callers" row
    expect(screen.queryByTestId("blast-symbol")).not.toBeInTheDocument();
    expect(screen.getByTestId("blast-idle")).toHaveTextContent("1 changed symbols with no callers");
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
      expect(screen.getByRole("button", { name: /foo/ })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: /bar/ })).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByText("src/r.ts:7")).toBeInTheDocument();
      expect(screen.queryByText("src/o.ts:3")).not.toBeInTheDocument();
    });

    it("toggles a symbol open and closed", () => {
      state.data = TWO;
      renderBlock();
      const second = screen.getByRole("button", { name: /bar/ });
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

  describe("tree / graph toggle", () => {
    it("defaults to the tree and switches to the graph and back", () => {
      state.data = DATA;
      renderBlock();
      const tree = screen.getByRole("button", { name: blast.view.tree });
      const graph = screen.getByRole("button", { name: blast.view.graph });
      expect(tree).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("blast-symbol")).toBeInTheDocument();

      fireEvent.click(graph);
      expect(graph).toHaveAttribute("aria-pressed", "true");
      expect(screen.queryByTestId("blast-symbol")).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: blast.graph.ariaLabel })).toBeInTheDocument();
      expect(screen.getByTestId("blast-node-symbol")).toHaveTextContent("foo");
      expect(screen.getByTestId("blast-node-caller")).toHaveTextContent("handler");
      expect(screen.getByTestId("blast-node-endpoint")).toHaveTextContent("GET /x");
      expect(screen.getByTestId("blast-node-cron")).toHaveTextContent("daily");

      fireEvent.click(tree);
      expect(screen.getByTestId("blast-symbol")).toBeInTheDocument();
    });

    it("shows the empty graph message when nothing is downstream", () => {
      state.data = {
        ...DATA,
        downstream: [{ symbol: "foo", callers: [], endpoints_affected: [], crons_affected: [] }],
      };
      renderBlock();
      fireEvent.click(screen.getByRole("button", { name: blast.view.graph }));
      expect(screen.getByText(blast.graph.empty)).toBeInTheDocument();
    });
  });

  describe("prior PRs", () => {
    const ITEM = {
      pr_number: 77,
      title: "Harden foo",
      merged_at: "2026-02-01T00:00:00Z",
      author: "dana",
      files_overlap: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
      notes: "n",
    };

    it("shows the count collapsed, then the PRs with GitHub links when expanded", () => {
      state.data = DATA;
      prior.data = { history: [ITEM] };
      renderBlock();
      const toggle = screen.getByRole("button", { name: new RegExp(blast.priorPrs.title) });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveTextContent("1");
      expect(screen.queryByTestId("blast-prior-pr")).not.toBeInTheDocument();

      fireEvent.click(toggle);
      expect(screen.getByRole("link", { name: "#77" })).toHaveAttribute(
        "href",
        "https://github.com/o/r/pull/77",
      );
      expect(screen.getByText("Harden foo")).toBeInTheDocument();
      expect(screen.getByText("a.ts")).toBeInTheDocument();
      expect(screen.queryByText("d.ts")).not.toBeInTheDocument();
      expect(screen.getByText("+2 more")).toBeInTheDocument();
      expect(screen.getByText(blast.priorPrs.scope)).toBeInTheDocument();
    });

    it("shows an empty message when no earlier PR touched these files", () => {
      state.data = DATA;
      renderBlock();
      fireEvent.click(screen.getByRole("button", { name: new RegExp(blast.priorPrs.title) }));
      expect(screen.getByText(blast.priorPrs.empty)).toBeInTheDocument();
    });

    it("renders nothing while loading and a message on error", () => {
      state.data = DATA;
      prior.isLoading = true;
      renderBlock();
      expect(screen.queryByTestId("blast-prior-prs")).not.toBeInTheDocument();
      cleanup();
      prior.isLoading = false;
      prior.data = undefined;
      prior.error = new Error("x");
      renderBlock();
      fireEvent.click(screen.getByRole("button", { name: new RegExp(blast.priorPrs.title) }));
      expect(screen.getByText(blast.priorPrs.error)).toBeInTheDocument();
    });
  });

  describe("many symbols", () => {
    const idleSym = (name: string) => ({
      symbol: name,
      callers: [],
      endpoints_affected: [],
      crons_affected: [],
    });
    const activeSym = (name: string) => ({
      symbol: name,
      callers: [{ name: "h", file: `src/${name}.ts`, line: 1 }],
      endpoints_affected: [],
      crons_affected: [],
    });
    const many = (nActive: number, nIdle: number): BlastData => {
      const downstream = [
        ...Array.from({ length: nActive }, (_, i) => activeSym(`act${i}`)),
        ...Array.from({ length: nIdle }, (_, i) => idleSym(`idle${i}`)),
      ];
      return {
        ...DATA,
        changed_symbols: downstream.map((d) => ({ name: d.symbol, file: "a.ts", kind: "function" })),
        downstream,
      };
    };

    it("lists a hundred caller-less symbols as one collapsed line, not a hundred rows", () => {
      state.data = many(0, 100);
      renderBlock();
      expect(screen.queryAllByTestId("blast-symbol")).toHaveLength(0);
      const idle = screen.getByTestId("blast-idle");
      expect(idle).toHaveTextContent("100 changed symbols with no callers");
      expect(screen.queryByText("idle0")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /100 changed symbols/ }));
      expect(screen.getByText("idle0")).toBeInTheDocument();
      expect(screen.getByText("idle99")).toBeInTheDocument();
    });

    it("caps the rows with callers and reveals the rest on request", () => {
      state.data = many(SYMBOLS_INITIAL + 5, 3);
      renderBlock();
      expect(screen.getAllByTestId("blast-symbol")).toHaveLength(SYMBOLS_INITIAL);
      fireEvent.click(screen.getByRole("button", { name: `Show all ${SYMBOLS_INITIAL + 5}` }));
      expect(screen.getAllByTestId("blast-symbol")).toHaveLength(SYMBOLS_INITIAL + 5);
      expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
    });

    it("keeps symbols with callers as rows and folds only the idle ones", () => {
      state.data = many(2, 4);
      renderBlock();
      expect(screen.getAllByTestId("blast-symbol")).toHaveLength(2);
      expect(screen.getByTestId("blast-idle")).toHaveTextContent("4 changed symbols with no callers");
    });
  });
});
