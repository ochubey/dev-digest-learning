import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/** `pr_brief`: one JSON document per PR. Validation happens in the service, not here. */
export class BriefRepository {
  constructor(private db: Db) {}

  /** The stored JSON, or undefined when no brief was generated. Untyped on purpose: callers parse it. */
  async getBrief(prId: string): Promise<unknown | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row?.json;
  }

  /** Last successful write wins (no compare-and-set). */
  async upsertBrief(prId: string, json: unknown): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json } });
  }
}
