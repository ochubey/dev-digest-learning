import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  doublePrecision,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { repos } from './repos';
import { agentRuns } from './runs';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'set null' }),
    githubRepoId: bigint('github_repo_id', { mode: 'number' }),
    slug: text('slug'),
    workflowVersion: integer('workflow_version'),
    agentVersion: integer('agent_version'),
    ciFailOn: text('ci_fail_on'),
    postAs: text('post_as'),
    triggers: jsonb('triggers').$type<string[]>().default([]),
    files: jsonb('files').$type<string[]>().default([]),
    prUrl: text('pr_url'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex('ci_installations_repo_uq').on(t.repo)],
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    agentName: text('agent_name'),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    githubRunId: bigint('github_run_id', { mode: 'number' }),
    repo: text('repo'),
    prTitle: text('pr_title'),
    commitSha: text('commit_sha'),
    verdict: text('verdict'),
    critical: integer('critical'),
    warning: integer('warning'),
    suggestion: integer('suggestion'),
    durationMs: integer('duration_ms'),
    model: text('model'),
    agentVersion: integer('agent_version'),
    runnerVersion: text('runner_version'),
    workflowVersion: integer('workflow_version'),
    reason: text('reason'),
  },
  (t) => [
    uniqueIndex('ci_runs_github_run_uq').on(t.githubRunId),
    index('ci_runs_ws_ran_idx').on(t.workspaceId, t.ranAt),
  ],
);
