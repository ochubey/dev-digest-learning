import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Intent } from '@devdigest/shared';

export class IntentRepository {
  constructor(private db: Db) {}

  async getIntent(prId: string): Promise<(typeof t.prIntent.$inferSelect) | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    return row;
  }

  async upsertIntent(
    prId: string,
    intent: Intent & {
      derivedFromHeadSha?: string;
      cacheKeyHash?: string;
      model?: string;
      tokens?: number;
      costUsd?: number;
      derivedBy?: string;
      basis?: NonNullable<(typeof t.prIntent.$inferInsert)['basis']>;
    },
  ): Promise<typeof t.prIntent.$inferSelect> {
    const values = {
      prId,
      summary: intent.summary,
      inScope: intent.in_scope,
      outOfScope: intent.out_of_scope,
      confidence: intent.confidence,
      sources: intent.sources,
      missingContext: intent.missing_context || [],
      basis: intent.basis,
      derivedFromHeadSha: intent.derivedFromHeadSha,
      cacheKeyHash: intent.cacheKeyHash,
      model: intent.model,
      tokens: intent.tokens,
      costUsd: intent.costUsd,
      derivedBy: intent.derivedBy || 'auto',
      intent: intent.intent || intent.summary,
      updatedAt: new Date(),
    };

    const result = await this.db
      .insert(t.prIntent)
      .values(values)
      .onConflictDoUpdate({
        target: t.prIntent.prId,
        set: values,
      })
      .returning();

    const saved = result[0];
    if (!saved) throw new Error(`Failed to upsert intent for PR ${prId}`);
    return saved;
  }
}
