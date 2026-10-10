import { sameOrderedList } from '../_shared/lists.js';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillSource, SkillType } from '@devdigest/shared';

/**
 * A1 — skills data-access. Owns `skills` and `skill_versions`. Workspace-scoped
 * throughout (skills belong to a workspace, same as agents).
 */

export type SkillRow = typeof t.skills.$inferSelect;
export type SkillVersionRow = typeof t.skillVersions.$inferSelect;

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source ?? 'manual',
        body: values.body,
        enabled: values.enabled ?? true,
        version: 1,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.snapshotVersion(row!);
    return row!;
  }

  /**
   * Update a skill's name/description/type/body. Always bumps `version` and
   * snapshots the OLD body into `skill_versions` first (mirrors the
   * `agent_versions` snapshot pattern in agents/repository.ts) — the new
   * body only ever exists as the CURRENT `skills.body`, never re-snapshotted
   * until it too becomes "old" on the next update.
   */
  async update(workspaceId: string, id: string, patch: UpdateSkill): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    await this.snapshotVersion(existing);

    const nextVersion = existing.version + 1;
    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        version: nextVersion,
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    return row;
  }

  /** Toggle `enabled` only — no version bump, no snapshot. */
  async setEnabled(workspaceId: string, id: string, enabled: boolean): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .update(t.skills)
      .set({ enabled })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    return row;
  }

  /**
   * Replace the ordered project-context attachment list. A differing list
   * snapshots the current body and bumps `version` (like `update`); an identical
   * list is a no-op. Returns undefined if the skill is unknown.
   */
  async setContextPaths(
    workspaceId: string,
    id: string,
    paths: string[],
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;
    const current = existing.contextPaths;
    if (sameOrderedList(current, paths)) {
      return existing;
    }
    await this.snapshotVersion(existing);
    const [row] = await this.db
      .update(t.skills)
      .set({ contextPaths: paths, version: existing.version + 1 })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    return row;
  }

  private async snapshotVersion(row: SkillRow): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row.id, version: row.version, body: row.body })
      .onConflictDoNothing();
  }

  /** All body snapshots for a skill, newest version first. */
  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /** A single version snapshot's body, or undefined if it doesn't exist. */
  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  /**
   * Restore a skill's body to a prior version's snapshot. Mirrors `update`:
   * snapshots the CURRENT (pre-restore) body first, then bumps `version` and
   * writes the restored body as the new current body.
   */
  async restoreVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const target = await this.getVersion(id, version);
    if (!target) return undefined;

    await this.snapshotVersion(existing);

    const nextVersion = existing.version + 1;
    const [row] = await this.db
      .update(t.skills)
      .set({ body: target.body, version: nextVersion })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();
    return row;
  }

  /** How many agents each of `skillIds` is linked to. Missing ids → 0. */
  async agentCounts(skillIds: string[]): Promise<Map<string, number>> {
    if (skillIds.length === 0) return new Map();
    const rows = await this.db
      .select({ skillId: t.agentSkills.skillId, count: sql<number>`count(*)::int` })
      .from(t.agentSkills)
      .where(inArray(t.agentSkills.skillId, skillIds))
      .groupBy(t.agentSkills.skillId);
    return new Map(rows.map((r) => [r.skillId, r.count]));
  }
}
