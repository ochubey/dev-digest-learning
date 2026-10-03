import type { Container } from '../../platform/container.js';
import type { Skill, SkillSource, SkillType, SkillVersion } from '@devdigest/shared';
import { SkillsRepository } from './repository.js';
import { toSkillDto, toSkillVersionDto } from './helpers.js';

/**
 * A1 — skills service. Business logic for the Skills Lab + Agent Editor's
 * Skills tab (linking itself is owned by A2's agents module — see
 * `AgentsRepository.linkedSkills`/`setSkills`).
 */

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
  evidence_files?: string[];
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(private container: Container) {
    this.repo = new SkillsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    const counts = await this.repo.agentCounts(rows.map((r) => r.id));
    return rows.map((r) => toSkillDto(r, counts.get(r.id) ?? 0));
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    const counts = await this.repo.agentCounts([id]);
    return toSkillDto(row, counts.get(id) ?? 0);
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      body: input.body,
      source: input.source ?? 'manual',
      enabled: input.enabled,
      evidenceFiles: input.evidence_files,
    });
    return toSkillDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkillInput,
  ): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, patch);
    if (!row) return undefined;
    const counts = await this.repo.agentCounts([id]);
    return toSkillDto(row, counts.get(id) ?? 0);
  }

  async setEnabled(
    workspaceId: string,
    id: string,
    enabled: boolean,
  ): Promise<Skill | undefined> {
    const row = await this.repo.setEnabled(workspaceId, id, enabled);
    if (!row) return undefined;
    const counts = await this.repo.agentCounts([id]);
    return toSkillDto(row, counts.get(id) ?? 0);
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Version history for a skill, newest first. `undefined` when the skill
   *  isn't in this workspace (route maps that to 404). */
  async listVersions(workspaceId: string, id: string): Promise<SkillVersion[] | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toSkillVersionDto);
  }

  /** Restore a skill's body to a prior version's snapshot — snapshots the
   *  current (pre-restore) body first, then bumps `version`. `undefined`
   *  when the skill or that version isn't found. */
  async restoreVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<Skill | undefined> {
    const row = await this.repo.restoreVersion(workspaceId, id, version);
    if (!row) return undefined;
    const counts = await this.repo.agentCounts([id]);
    return toSkillDto(row, counts.get(id) ?? 0);
  }
}
