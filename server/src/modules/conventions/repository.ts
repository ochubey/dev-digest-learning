import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Conventions data-access. Owns the `conventions` table. Workspace-scoped
 * throughout (mirrors skills/repository.ts).
 */

export type ConventionRow = typeof t.conventions.$inferSelect;

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  rule: string;
  category?: string | null;
  evidencePath?: string | null;
  evidenceSnippet?: string | null;
  confidence?: number | null;
}

export interface UpdateConvention {
  rule?: string;
  category?: string | null;
  evidencePath?: string | null;
  evidenceSnippet?: string | null;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  /** All candidates for a repo, any status (pending/accepted/rejected). */
  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async getByIds(workspaceId: string, ids: string[]): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select()
      .from(t.conventions)
      .where(eq(t.conventions.workspaceId, workspaceId));
    const idSet = new Set(ids);
    return rows.filter((r) => idSet.has(r.id));
  }

  async insertMany(values: InsertConvention[]): Promise<ConventionRow[]> {
    if (values.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        values.map((v) => ({
          workspaceId: v.workspaceId,
          repoId: v.repoId,
          rule: v.rule,
          category: v.category ?? null,
          evidencePath: v.evidencePath ?? null,
          evidenceSnippet: v.evidenceSnippet ?? null,
          confidence: v.confidence ?? null,
          accepted: false,
          rejected: false,
        })),
      )
      .returning();
  }

  async setAccepted(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ accepted: true })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async setRejected(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ rejected: true, accepted: false })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.evidencePath !== undefined ? { evidencePath: patch.evidencePath } : {}),
        ...(patch.evidenceSnippet !== undefined
          ? { evidenceSnippet: patch.evidenceSnippet }
          : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
