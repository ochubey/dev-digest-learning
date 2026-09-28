import { pgTable, uuid, text, jsonb, timestamp, doublePrecision, boolean, vector, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

export const conventions = pgTable('conventions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
  rule: text('rule').notNull(),
  // From the LLM extraction's {category, rule, evidence, confidence} shape
  // (rubric #40) — was previously (incorrectly) folded into evidenceSnippet.
  category: text('category'),
  evidencePath: text('evidence_path'),
  evidenceSnippet: text('evidence_snippet'),
  confidence: doublePrecision('confidence'),
  accepted: boolean('accepted').notNull().default(false),
  // Distinct from `accepted=false` (still pending): a rejected candidate must
  // survive reload without reappearing (rubric requirement) and must never be
  // folded into the resulting skill, so it needs its own persisted flag rather
  // than reusing the accepted/not-accepted boolean.
  rejected: boolean('rejected').notNull().default(false),
});
