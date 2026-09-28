import type { SkillSource } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Source icon, per `Skill.source`. Simplified from the design mock's
    `SKILL_SOURCE` icon-map idea (manual pencil / imported file+URL /
    extracted from history / community catalog). */
export const SKILL_SOURCE_ICON: Record<SkillSource, IconName> = {
  manual: "Edit",
  imported_file: "Upload",
  imported_url: "Globe",
  extracted: "Sparkles",
  community: "Users",
};
