import { isContextDocPath, normalizeContextPath } from './paths.js';

export interface SkillContext {
  id: string;
  name: string;
  enabled: boolean;
  contextPaths: string[];
}

export interface EffectiveDoc {
  path: string;
  origin: 'agent' | 'skill';
  skillId?: string;
  skillName?: string;
}

/**
 * Documents a review run uses: enabled skills' docs first (skill order), then the agent's own.
 * First occurrence of a path wins. Callers pass enabled skills only.
 */
export function effectiveDocs(
  enabledSkillsInOrder: Pick<SkillContext, 'id' | 'name' | 'contextPaths'>[],
  agentPaths: string[],
): EffectiveDoc[] {
  const seen = new Set<string>();
  const out: EffectiveDoc[] = [];
  for (const skill of enabledSkillsInOrder) {
    for (const raw of skill.contextPaths) {
      const path = normalizeContextPath(raw);
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ path, origin: 'skill', skillId: skill.id, skillName: skill.name });
    }
  }
  for (const raw of agentPaths) {
    const path = normalizeContextPath(raw);
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, origin: 'agent' });
  }
  return out;
}

export type AttachValidation =
  | { ok: true; paths: string[] }
  | { ok: false; reason: 'invalid_path' | 'duplicate'; path: string };

/** Validate an attach list: every path valid, no duplicates after `./` trim. Returns normalized paths. */
export function validateAttachList(paths: string[]): AttachValidation {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const path = normalizeContextPath(raw);
    if (!isContextDocPath(path)) return { ok: false, reason: 'invalid_path', path: raw };
    if (seen.has(path)) return { ok: false, reason: 'duplicate', path: raw };
    seen.add(path);
    out.push(path);
  }
  return { ok: true, paths: out };
}

/**
 * Agents using `path`: attached directly, or through a linked ENABLED skill that has it.
 * Disabled agents count; each agent counts once.
 */
export function countUsedBy(
  path: string,
  agents: { contextPaths: string[]; skillIds: string[] }[],
  skills: Pick<SkillContext, 'id' | 'enabled' | 'contextPaths'>[],
): number {
  const target = normalizeContextPath(path);
  const has = (list: string[]) => list.some((p) => normalizeContextPath(p) === target);
  const skillsWithDoc = new Set(skills.filter((s) => s.enabled && has(s.contextPaths)).map((s) => s.id));
  return agents.filter((a) => has(a.contextPaths) || a.skillIds.some((id) => skillsWithDoc.has(id)))
    .length;
}
