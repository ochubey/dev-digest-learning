import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Skill } from "@devdigest/shared";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mk = (id: string, name: string): Skill => ({
  id, name, description: `${name} desc`, type: "custom", source: "manual", body: "b", enabled: true, version: 1, agent_count: 0,
});
const SKILLS = [mk("sk1", "no-any"), mk("sk2", "perf-checks")];
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS }),
  useSetSkillEnabled: () => ({ mutate: vi.fn() }),
  useDeleteSkill: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SkillsSidebar } from "./SkillsSidebar";

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("SkillsSidebar", () => {
  it("lists all skills compactly and marks the active one", () => {
    render(<SkillsSidebar activeId="sk2" tab="config" />);
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByText("no-any")).toBeInTheDocument();
    expect(screen.queryByText("no-any desc")).not.toBeInTheDocument();
    const active = screen.getByText("perf-checks").closest("[aria-current]");
    expect(active).not.toBeNull();
    expect(screen.getByText("no-any").closest("[aria-current]")).toBeNull();
  });

  it("clicking another skill keeps the current tab", () => {
    render(<SkillsSidebar activeId="sk2" tab="context" />);
    fireEvent.click(screen.getByText("no-any"));
    expect(push).toHaveBeenCalledWith("/skills/sk1?tab=context");
  });

  it("Add opens the add-skill modal in place", () => {
    render(<SkillsSidebar activeId="sk1" tab="config" />);
    fireEvent.click(screen.getByRole("button", { name: /Add/ }));
    expect(screen.getByText("Create from scratch")).toBeInTheDocument();
  });
});
