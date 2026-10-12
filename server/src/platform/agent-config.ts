import type { EvalRunManifest } from '@devdigest/shared';
import type { AgentRow } from '../db/rows.js';

/**
 * Pure builders shared by the agents module (version snapshots), the evals module
 * (run manifests) and the demo seed. No I/O; lives outside `modules/` so `db/` can use it.
 */

/**
 * The immutable `agent_versions.config_json` snapshot for an agent row plus its
 * linked skill ids. Shared by `snapshotVersion` and the eval manifest so both
 * always agree on the shape.
 */
export function versionConfigOf(row: AgentRow, skillIds: string[]) {
  return {
    provider: row.provider,
    model: row.model,
    system_prompt: row.systemPrompt,
    output_schema: row.outputSchema,
    strategy: row.strategy,
    ci_fail_on: row.ciFailOn,
    repo_intel: row.repoIntel,
    skills: skillIds,
    context_paths: row.contextPaths,
  };
}

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
