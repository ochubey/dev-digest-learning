import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  search: new URLSearchParams(),
  latest: { data: undefined, isLoading: false, isError: false } as {
    data?: { id: string | null };
    isLoading: boolean;
    isError: boolean;
  },
  latestArg: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useSearchParams: () => h.search,
}));
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo-not-found</div> }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "o/r" } }),
  useRepoNotFound: () => false,
}));
vi.mock("@/lib/hooks/multi-agent", () => ({
  useLatestMultiAgentRun: (id: string | null) => {
    h.latestArg(id);
    return h.latest;
  },
}));
vi.mock("./_components/ConfigureRun", () => ({ ConfigureRun: () => <div>configure-run</div> }));
vi.mock("./_components/MultiAgentResults", () => ({
  MultiAgentResults: ({ id }: { id: string }) => <div>results-{id}</div>,
}));

import MultiAgentPage from "./page";

function setup(query: string, latest: Partial<typeof h.latest>) {
  h.search = new URLSearchParams(query);
  h.latest = { data: undefined, isLoading: false, isError: false, ...latest };
  h.latestArg.mockReset();
  return render(<MultiAgentPage />);
}

afterEach(cleanup);

describe("MultiAgentPage", () => {
  it("shows a skeleton while the latest run loads", () => {
    setup("", { isLoading: true });
    expect(screen.getByTestId("latest-skeleton")).toBeInTheDocument();
  });

  it("renders the latest run's results when one exists", () => {
    setup("", { data: { id: "m1" } });
    expect(screen.getByText("results-m1")).toBeInTheDocument();
  });

  it("renders Configure run when there is no run yet", () => {
    setup("", { data: { id: null } });
    expect(screen.getByText("configure-run")).toBeInTheDocument();
  });

  it("renders Configure run on error", () => {
    setup("", { isError: true });
    expect(screen.getByText("configure-run")).toBeInTheDocument();
  });

  it("?pr or ?agents always renders Configure run and does not query the latest run", () => {
    setup("pr=5", { data: { id: "m1" } });
    expect(screen.getByText("configure-run")).toBeInTheDocument();
    expect(h.latestArg).toHaveBeenCalledWith(null);
    cleanup();
    setup("agents=a1", { data: { id: "m1" } });
    expect(screen.getByText("configure-run")).toBeInTheDocument();
  });
});
