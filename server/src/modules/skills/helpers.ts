import type { Skill, SkillVersion } from '@devdigest/shared';
import type { SkillRow, SkillVersionRow } from './repository.js';

/** Pure DB row ⇄ DTO mapping for the skills module. No I/O. */

export function toSkillDto(row: SkillRow, agentCount = 0): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as Skill['type'],
    source: row.source as Skill['source'],
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
    agent_count: agentCount,
  };
}

export function toSkillVersionDto(row: SkillVersionRow): SkillVersion {
  return {
    skill_id: row.skillId,
    version: row.version,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}
