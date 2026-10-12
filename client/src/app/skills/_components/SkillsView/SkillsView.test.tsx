import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Skill } from "@devdigest/shared";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const SKILLS: Skill[] = [
  { id: "sk1", name: "no-any", description: "Ban any", type: "convention", source: "manual", body: "b", enabled: true, version: 1, agent_count: 0 },
  { id: "sk2", name: "perf-checks", description: "Perf", type: "rubric", source: "manual", body: "b", enabled: true, version: 1, agent_count: 1 },
];
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetSkillEnabled: () => ({ mutate: vi.fn() }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SkillsView } from "./SkillsView";

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("SkillsView", () => {
  it("navigates straight to the skill editor config tab on card click, without a drawer", () => {
    render(<SkillsView />);
    fireEvent.click(screen.getByText("perf-checks"));
    expect(push).toHaveBeenCalledWith("/skills/sk2?tab=config");
    expect(screen.queryByRole("button", { name: "Open" })).not.toBeInTheDocument();
  });
});
