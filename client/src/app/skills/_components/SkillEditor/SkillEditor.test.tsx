import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Skill, SkillVersion } from "@devdigest/shared";

const createMutate = vi.fn();
const updateMutate = vi.fn();
const setEnabledMutate = vi.fn();
const deleteMutate = vi.fn();
const restoreMutate = vi.fn();

const VERSIONS: SkillVersion[] = [
  { skill_id: "sk1", version: 2, body: "# v2 body", created_at: "2026-09-20T10:00:00.000Z" },
  { skill_id: "sk1", version: 1, body: "# v1 body", created_at: "2026-09-01T10:00:00.000Z" },
];

vi.mock("../../../../lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateSkill: () => ({ mutateAsync: updateMutate, isPending: false }),
  useSetSkillEnabled: () => ({ mutate: setEnabledMutate, isPending: false }),
  useDeleteSkill: () => ({ mutate: deleteMutate, isPending: false }),
  useSkillVersions: () => ({ data: VERSIONS, isLoading: false }),
  useRestoreSkillVersion: () => ({ mutate: restoreMutate, isPending: false }),
}));

import { SkillEditor } from "./SkillEditor";

const SKILL: Skill = {
  id: "sk1",
  name: "no-any",
  description: "Ban explicit any",
  type: "convention",
  source: "manual",
  body: "# no-any\nBan `any`.",
  enabled: true,
  version: 2,
  agent_count: 0,
};

afterEach(() => {
  cleanup();
  createMutate.mockClear();
  updateMutate.mockClear();
  setEnabledMutate.mockClear();
  deleteMutate.mockClear();
});

describe("SkillEditor", () => {
  it("renders the Config tab by default with the skill's fields", () => {
    render(<SkillEditor skill={SKILL} />);
    expect(screen.getByDisplayValue("no-any")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ban explicit any")).toBeInTheDocument();
  });

  it("switches to the Preview tab and renders markdown from the body", () => {
    render(<SkillEditor skill={SKILL} />);
    fireEvent.click(screen.getByText("Preview"));
    expect(screen.getByText("no-any", { selector: "h1" })).toBeInTheDocument();
  });

  it("switches to the Versions tab and lists version rows", () => {
    render(<SkillEditor skill={SKILL} />);
    fireEvent.click(screen.getByText("Versions"));
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("only renders three tabs (Config, Preview, Versions)", () => {
    render(<SkillEditor skill={SKILL} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Versions")).toBeInTheDocument();
    expect(screen.queryByText("Context")).not.toBeInTheDocument();
    expect(screen.queryByText("Evals")).not.toBeInTheDocument();
    expect(screen.queryByText("Stats")).not.toBeInTheDocument();
  });

  it("create mode (skill=null) shows a 'Create Skill' save button and no Delete", () => {
    render(<SkillEditor skill={null} />);
    expect(screen.getByText("Create Skill")).toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("Delete asks for confirmation and calls the delete mutation", () => {
    const onDeleted = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SkillEditor skill={SKILL} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(deleteMutate).toHaveBeenCalledWith("sk1", expect.anything());
    vi.restoreAllMocks();
  });
});
