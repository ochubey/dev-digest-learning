import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Skill } from "@devdigest/shared";

const mutate = vi.fn();

vi.mock("../../../../lib/hooks/skills", () => ({
  useSetSkillEnabled: () => ({ mutate, isPending: false }),
}));

import { SkillCard } from "./SkillCard";

const SKILL: Skill = {
  id: "sk1",
  name: "no-any",
  description: "Ban explicit any",
  type: "convention",
  source: "manual",
  body: "# no-any",
  enabled: true,
  version: 2,
  agent_count: 3,
};

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

describe("SkillCard", () => {
  it("renders name, description, type badge and version", () => {
    render(<SkillCard skill={SKILL} />);
    expect(screen.getByText("no-any")).toBeInTheDocument();
    expect(screen.getByText("Ban explicit any")).toBeInTheDocument();
    expect(screen.getByText("convention")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("3 agents")).toBeInTheDocument();
  });

  it("calls onClick when the card is clicked", () => {
    const onClick = vi.fn();
    render(<SkillCard skill={SKILL} onClick={onClick} />);
    fireEvent.click(screen.getByText("no-any"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("toggling enabled calls useSetSkillEnabled without bubbling to onClick", () => {
    const onClick = vi.fn();
    render(<SkillCard skill={SKILL} onClick={onClick} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(mutate).toHaveBeenCalledWith({ id: "sk1", enabled: false });
    expect(onClick).not.toHaveBeenCalled();
  });
});
