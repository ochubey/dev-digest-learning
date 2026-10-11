import type { EvalRunManifest } from '@devdigest/shared';
import type { AgentRow } from '../../db/rows.js';
import { versionConfigOf } from '../agents/helpers.js';

export interface ManifestSkill {
  id: string;
  name: string;
  version: number;
}

/**
 * AC-33: the frozen description of what a run executes. It is the agent's version
 * snapshot (`versionConfigOf`, shared with `snapshotVersion`) plus the id, name and
 * version of each enabled linked skill whose body is used. `skillIds` are all linked
 * skills in link order (as in the snapshot); `enabledSkills` is the subset in use.
 */
export function buildManifest(
  agent: AgentRow,
  skillIds: string[],
  enabledSkills: ManifestSkill[],
): EvalRunManifest {
  const cfg = versionConfigOf(agent, skillIds);
  return {
    provider: cfg.provider,
    model: cfg.model,
    system_prompt: cfg.system_prompt,
    output_schema: cfg.output_schema ?? null,
    strategy: cfg.strategy,
    ci_fail_on: cfg.ci_fail_on,
    repo_intel: cfg.repo_intel,
    skills: cfg.skills,
    skill_versions: enabledSkills.map((s) => ({ id: s.id, name: s.name, version: s.version })),
  };
}
