import type { Skill } from "@devdigest/shared";

/** Case-insensitive filter over name + description, mirroring
    AgentsListView's `filterAgents` helper. */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (sk) => sk.name.toLowerCase().includes(q) || sk.description.toLowerCase().includes(q),
  );
}
