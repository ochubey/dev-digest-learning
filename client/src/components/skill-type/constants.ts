import type { SkillType } from "@devdigest/shared";

/** Type-badge colors, keyed by `Skill.type` (design-canvas mock:
    screen_agents.jsx SkillsTab). Promoted here from the Agent Editor's
    SkillsTab because the standalone `/skills` page needs the same colors —
    used by 2+ places now, so it lives in shared `src/components/` per
    `docs/ui-architecture.md`. */
export const SKILL_TYPE_COLOR: Record<SkillType, string> = {
  rubric: "#3b82f6",
  convention: "#10b981",
  security: "#ef4444",
  custom: "#999999",
};
