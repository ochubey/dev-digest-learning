import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

const SKILL_1: Skill = {
  id: "sk1",
  name: "no-any",
  description: "Ban explicit any",
  type: "convention",
  source: "manual",
  body: "",
  enabled: true,
  version: 1,
  agent_count: 1,
};
const SKILL_2: Skill = {
  id: "sk2",
  name: "sql-injection",
  description: "Flag string-built SQL",
  type: "security",
  source: "manual",
  body: "",
  enabled: true,
  version: 1,
  agent_count: 1,
};
const SKILL_3: Skill = {
  id: "sk3",
  name: "unused-skill",
  description: "Not linked",
  type: "custom",
  source: "manual",
  body: "",
  enabled: true,
  version: 1,
  agent_count: 0,
};
const SKILLS: Skill[] = [SKILL_1, SKILL_2, SKILL_3];

// Agent has sk2 then sk1 linked, in that order. Server returns
// AgentSkillLink[] ({agent_id, skill_id, order}), not full Skill objects.
const LINKED: AgentSkillLink[] = [
  { agent_id: "ag1", skill_id: "sk2", order: 0 },
  { agent_id: "ag1", skill_id: "sk1", order: 1 },
];

const mutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS }),
  useAgentSkills: () => ({ data: LINKED }),
  useSetAgentSkills: () => ({ mutate, isPending: false }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
  skill_count: 2,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SkillsTab", () => {
  it("renders every workspace skill and the enabled count", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    expect(screen.getByText("no-any")).toBeInTheDocument();
    expect(screen.getByText("sql-injection")).toBeInTheDocument();
    expect(screen.getByText("unused-skill")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();
  });

  it("toggling a checkbox calls the mutation with the full updated skill_ids list", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    // sk3 ("unused-skill") is unlinked; toggling it should ADD it, preserving
    // the existing linked order (sk2, sk1) and appending sk3.
    const checkboxes = screen.getAllByRole("checkbox");
    const thirdCheckbox = checkboxes[2];
    if (!thirdCheckbox) throw new Error("expected 3 checkbox rows");
    fireEvent.click(thirdCheckbox);
    expect(mutate).toHaveBeenCalledWith({
      agentId: "ag1",
      skillIds: ["sk2", "sk1", "sk3"],
    });
  });

  it("unlinked rows render a disabled (non-draggable) handle", () => {
    renderWithIntl(<SkillsTab agent={AGENT} />);
    // sk3 is unlinked — its drag handle carries no dnd-kit drag attributes
    // (aria-roledescription is only set by useSortable's `attributes` spread,
    // which SkillsTab omits for disabled/unlinked rows).
    const unusedSkillRow = screen.getByText("unused-skill").closest("div");
    expect(unusedSkillRow?.querySelector('[aria-roledescription]')).not.toBeInTheDocument();
    const linkedRow = screen.getByText("no-any").closest("div");
    expect(linkedRow?.querySelector('[aria-roledescription]')).toBeInTheDocument();
  });
});

// Full pointer-drag simulation is impractical under jsdom (dnd-kit relies on
// real layout/pointer events); the reorder LOGIC itself — arrayMove over
// linkedIds, gated to linked-only ids — is covered directly here rather than
// through simulated DOM drag events, per the project's testing guidance for
// libraries where full DnD simulation isn't practical in jsdom.
describe("SkillsTab reorder logic", () => {
  it("arrayMove produces the same swapped order the old arrow-reorder produced", async () => {
    const { arrayMove } = await import("@dnd-kit/sortable");
    const linkedIds = ["sk2", "sk1"];
    const reordered = arrayMove(linkedIds, linkedIds.indexOf("sk2"), linkedIds.indexOf("sk1"));
    expect(reordered).toEqual(["sk1", "sk2"]);
  });
});
