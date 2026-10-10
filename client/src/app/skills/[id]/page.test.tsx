import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Skill } from "@devdigest/shared";

let tabParam: string | null = null;
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "sk1" }),
  useSearchParams: () => ({ get: () => tabParam, toString: () => (tabParam ? `tab=${tabParam}` : "") }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../_components/SkillsSidebar", () => ({
  SkillsSidebar: ({ activeId, tab }: { activeId: string; tab: string }) => (
    <aside data-testid="sidebar">{`${activeId}:${tab}`}</aside>
  ),
}));
vi.mock("../_components/SkillEditor", () => ({
  SkillEditor: ({ tab }: { tab: string }) => <div data-testid="editor">{tab}</div>,
}));

const SKILL: Skill = {
  id: "sk1", name: "no-any", description: "d", type: "convention", source: "manual", body: "b", enabled: true, version: 2, agent_count: 1,
};
let skillState: { data?: Skill; isLoading: boolean; isError: boolean };
vi.mock("@/lib/hooks/skills", () => ({
  useSkill: () => ({ ...skillState, error: null, refetch: vi.fn() }),
}));

import SkillDetailPage from "./page";

afterEach(() => {
  cleanup();
  tabParam = null;
});

describe("SkillDetailPage", () => {
  it("renders the sidebar and the header with the context tab for ?tab=context", () => {
    tabParam = "context";
    skillState = { data: SKILL, isLoading: false, isError: false };
    render(<SkillDetailPage />);
    expect(screen.getByTestId("sidebar")).toHaveTextContent("sk1:context");
    expect(screen.getByRole("heading", { name: "no-any" })).toBeInTheDocument();
    expect(screen.getByTestId("editor")).toHaveTextContent("context");
  });

  it("falls back to config for an unknown tab", () => {
    tabParam = "nope";
    skillState = { data: SKILL, isLoading: false, isError: false };
    render(<SkillDetailPage />);
    expect(screen.getByTestId("editor")).toHaveTextContent("config");
  });

  it("keeps the sidebar and hides the editor while loading", () => {
    skillState = { isLoading: true, isError: false };
    render(<SkillDetailPage />);
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
  });

  it("shows the error state for a missing skill", () => {
    skillState = { isLoading: false, isError: true };
    render(<SkillDetailPage />);
    expect(screen.getByText("Couldn't load this skill")).toBeInTheDocument();
  });
});
