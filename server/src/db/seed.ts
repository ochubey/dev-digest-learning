import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  API_CONTRACT_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { wrapProjectDoc } from '@devdigest/reviewer-core';
import type { RunTrace } from '@devdigest/shared';
import { TiktokenTokenizer } from '../adapters/tokenizer/index.js';
import { PROJECT_DOCS_FIXTURE } from './fixtures/project-docs.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, and the three built-in agents (General + Security +
 * Performance), all on the default openrouter/deepseek-v4-flash provider+model.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

/** Fixed id of the seeded agent run whose trace shows injected project context (e2e flow 10). */
export const SEED_PROJECT_CONTEXT_RUN_ID = '5eed0000-0000-4000-8000-000000000c01';
/** Project docs attached to the seeded Security Reviewer: 2 of the 4 fixture docs, so "attached first" is observable. */
export const SEED_CONTEXT_PATHS = ['specs/security-baseline.md', 'docs/architecture.md'];

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- PR #483: finding whose start_line lies OUTSIDE every diff hunk ----
  // A real model is gated by citation grounding and never emits this, so it must be seeded
  // to exercise the "finding outside the patch" UI path.
  const [pr483] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 483)));
  if (!pr483) {
    const [pr2] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 483,
        title: 'Tweak retry delay in payments client',
        author: 'marisa.koch',
        branch: 'fix/retry-delay',
        base: 'main',
        headSha: 'f6e5d4c3b2a1',
        additions: 2,
        deletions: 1,
        filesCount: 1,
        status: 'needs_review',
        body: 'Lower the retry delay.',
      })
      .returning();

    await db.insert(t.prFiles).values({
      prId: pr2!.id,
      path: 'src/api/payments.ts',
      additions: 2,
      deletions: 1,
      // single hunk: new-file lines 10-13 only
      patch: [
        '@@ -10,3 +10,4 @@ export async function charge() {',
        '   const res = await client.post(url, body);',
        '-  await sleep(1000);',
        '+  await sleep(250);',
        '+  // retry quickly',
        '   return res;',
      ].join('\n'),
    });

    const [review2] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr2!.id,
        kind: 'review',
        verdict: 'comment',
        summary: 'Small change; one finding points at a line outside the patch.',
        score: 80,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values({
      reviewId: review2!.id,
      file: 'src/api/payments.ts',
      startLine: 80, // outside the only hunk (lines 10-13)
      endLine: 82,
      severity: 'WARNING',
      category: 'correctness',
      title: 'Unbounded retry loop outside the changed hunk',
      rationale: 'Line 80 retries forever; this line is not part of the diff.',
      suggestion: 'Cap the number of attempts.',
      confidence: 0.7,
    });
  }

  // ---- PR #482 demo extras: diff patches for every file ----
  // Applied as idempotent top-ups (not inside the insert above) so databases seeded by an
  // older version pick them up on the next run. Only files WITHOUT a patch are touched, so a
  // real GitHub refresh (or a hand edit) is never overwritten.
  //
  // The seeded PRs deliberately have NO Intent: the Intent card starts as "Intent not yet
  // analysed" and the demo clicks Run Intent. Finding scope is likewise left unset (legacy =
  // in scope); scoped findings come from real review runs against a derived intent.
  const [pr482] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (pr482) {
    // Stats match the patch excerpts below. Finding lines (config.ts:12, users.ts:45-52) sit
    // inside their hunks.
    const patches: Record<string, { additions: number; deletions: number; patch: string }> = {
      'src/config.ts': {
        additions: 5,
        deletions: 0,
        patch: [
          '@@ -9,4 +9,9 @@ export const config = {',
          '   port: 3000,',
          '   env: process.env.NODE_ENV,',
          '   logLevel: "info",',
          "+  stripeSecretKey: 'sk_live_EXAMPLE_NOT_A_REAL_KEY',",
          '+  rateLimit: {',
          '+    windowMs: 60_000,',
          '+    max: 100,',
          '+  },',
          ' };',
        ].join('\n'),
      },
      'src/api/users.ts': {
        additions: 7,
        deletions: 2,
        patch: [
          '@@ -44,4 +44,9 @@ export async function listUsers() {',
          '   const users = await db.select().from(usersTable);',
          '-  const orders = await db.select().from(ordersTable);',
          '-  return users.map((u) => ({ ...u, orders: orders.filter((o) => o.userId === u.id) }));',
          '+  // one orders query per user',
          '+  const out = [];',
          '+  for (const u of users) {',
          '+    const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, u.id));',
          '+    out.push({ ...u, orders });',
          '+  }',
          '+  return out;',
          ' }',
        ].join('\n'),
      },
      'src/middleware/ratelimit.ts': {
        additions: 22,
        deletions: 0,
        patch: [
          '@@ -0,0 +1,22 @@',
          '+import type { FastifyReply, FastifyRequest } from "fastify";',
          '+import { config } from "../config";',
          '+',
          '+const buckets = new Map<string, { tokens: number; updatedAt: number }>();',
          '+',
          '+/** Token-bucket limiter keyed by client IP. */',
          '+export async function rateLimit(req: FastifyRequest, reply: FastifyReply) {',
          '+  const { max, windowMs } = config.rateLimit;',
          '+  const now = Date.now();',
          '+  const bucket = buckets.get(req.ip) ?? { tokens: max, updatedAt: now };',
          '+  const refill = ((now - bucket.updatedAt) / windowMs) * max;',
          '+  bucket.tokens = Math.min(max, bucket.tokens + refill);',
          '+  bucket.updatedAt = now;',
          '+  if (bucket.tokens < 1) {',
          '+    buckets.set(req.ip, bucket);',
          '+    return reply.code(429).header("Retry-After", Math.ceil(windowMs / 1000)).send({ error: "rate_limited" });',
          '+  }',
          '+  bucket.tokens -= 1;',
          '+  buckets.set(req.ip, bucket);',
          '+}',
          '+',
          '+export const _buckets = buckets; // exposed for tests',
        ].join('\n'),
      },
      'src/api/public/webhooks.ts': {
        additions: 7,
        deletions: 2,
        patch: [
          '@@ -1,5 +1,10 @@',
          ' import type { FastifyInstance } from "fastify";',
          '+import { rateLimit } from "../../middleware/ratelimit";',
          '+import crypto from "node:crypto";',
          ' ',
          '-export async function webhooks(app: FastifyInstance) {',
          '-  app.post("/webhooks/stripe", async (req) => handle(req.body));',
          '+export async function webhooks(app: FastifyInstance) {',
          '+  // public endpoint: rate limited per client IP',
          '+  app.addHook("onRequest", rateLimit);',
          '+  app.post("/webhooks/stripe", async (req) => handle(req.body));',
          '+  app.post("/webhooks/github", async (req) => handle(req.body));',
          ' }',
        ].join('\n'),
      },
    };
    for (const [path, { patch, additions, deletions }] of Object.entries(patches)) {
      await db
        .update(t.prFiles)
        .set({ patch, additions, deletions })
        .where(and(eq(t.prFiles.prId, pr482.id), eq(t.prFiles.path, path), isNull(t.prFiles.patch)));
    }

    // Clean up what older seed versions added: a pre-made Intent (the demo starts empty now) and
    // scoped sample findings. Only rows the seed itself wrote (model = 'seed') are touched, so an
    // Intent derived by a real model, or findings from real runs, are never removed.
    await db.delete(t.prIntent).where(and(eq(t.prIntent.prId, pr482.id), eq(t.prIntent.model, 'seed')));
    const seedReviews = await db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(and(eq(t.reviews.prId, pr482.id), eq(t.reviews.model, 'seed')));
    for (const { id } of seedReviews) {
      await db
        .delete(t.findings)
        .where(and(eq(t.findings.reviewId, id), eq(t.findings.title, 'Unused import in webhooks handler')));
      await db
        .update(t.findings)
        .set({ scope: null, scopeReason: null })
        .where(eq(t.findings.reviewId, id));
    }
  }

  // ---- built-in agents (the four starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Flags breaking changes to route/handler signatures and response shapes.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- link API Contract Reviewer with breaking-change-detector skill ----
  const [apiContractReviewerAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'API Contract Reviewer')));

  if (apiContractReviewerAgent) {
    // Ensure the breaking-change-detector skill exists
    const [breakingChangeSkill] = await db
      .select()
      .from(t.skills)
      .where(
        and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, 'breaking-change-detector')),
      );
    if (!breakingChangeSkill) {
      const [newSkill] = await db
        .insert(t.skills)
        .values({
          workspaceId,
          name: 'breaking-change-detector',
          description: 'Flags removed/renamed params or changed response shapes',
          type: 'rubric',
          source: 'manual',
          body: `# Breaking-change detector

Flag route/handler signature changes that remove or rename a required parameter, or change a response shape callers rely on.

## What to look for
- Removed required parameters (callers sending them will be silently ignored).
- Renamed parameters or fields.
- Changed response shape or field types.
- Changed or removed endpoints.
- Type narrowing that breaks existing callers.`,
        })
        .returning();
      await db.insert(t.agentSkills).values({ agentId: apiContractReviewerAgent.id, skillId: newSkill!.id }).onConflictDoNothing();
    } else {
      // Link existing skill if not already linked
      await db.insert(t.agentSkills).values({ agentId: apiContractReviewerAgent.id, skillId: breakingChangeSkill.id }).onConflictDoNothing();
    }
  }

  // ---- project context: attached docs on Security Reviewer + one run trace that shows them ----
  const [securityAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
  if (securityAgent) {
    // Top-up only while nothing is attached, so a user's own attach/detach is not overwritten.
    if (securityAgent.contextPaths.length === 0) {
      await db.update(t.agents).set({ contextPaths: SEED_CONTEXT_PATHS }).where(eq(t.agents.id, securityAgent.id));
    }
    if (pr482) {
      await seedProjectContextRun(db, { workspaceId, prId: pr482.id, prNumber: pr482.number, agent: securityAgent });
    }
  }

  return { workspaceId, userId };
}

/**
 * One finished run (no findings, no review row) whose trace carries the project-context fields,
 * built with the same wrapper and tokenizer as a live run. Fixed id; insert-if-absent.
 */
async function seedProjectContextRun(
  db: Db,
  a: { workspaceId: string; prId: string; prNumber: number; agent: typeof t.agents.$inferSelect },
): Promise<void> {
  const docs = PROJECT_DOCS_FIXTURE['acme/payments-api']!;
  const tokenizer = new TiktokenTokenizer();
  const injected = SEED_CONTEXT_PATHS.map((path) => {
    const content = docs[path]!;
    return { path, tokens: tokenizer.count(content), text: wrapProjectDoc(path, content) };
  });
  const injectedTokens = injected.reduce((n, d) => n + d.tokens, 0);

  await db
    .insert(t.agentRuns)
    .values({
      id: SEED_PROJECT_CONTEXT_RUN_ID,
      workspaceId: a.workspaceId,
      agentId: a.agent.id,
      prId: a.prId,
      provider: a.agent.provider,
      model: a.agent.model,
      durationMs: 1200,
      tokensIn: 900,
      tokensOut: 40,
      status: 'done',
      source: 'local',
      findingsCount: 0,
      grounding: '0/0',
      score: 100,
      blockers: 0,
      severityCounts: { critical: 0, warning: 0, suggestion: 0 },
    })
    .onConflictDoNothing();

  const trace: RunTrace = {
    config: {
      agent: a.agent.name,
      version: `v${a.agent.version}`,
      provider: a.agent.provider,
      model: a.agent.model,
      pr: a.prNumber,
      source: 'local',
    },
    stats: { duration_ms: 1200, tokens_in: 900, tokens_out: 40, cost_usd: null, findings: 0, grounding: '0/0' },
    prompt_assembly: {
      system: a.agent.systemPrompt,
      project_context_blocks: injected,
      user: `Review PR #${a.prNumber}.`,
    },
    tool_calls: [],
    raw_output: '{"verdict":"comment","summary":"Seeded run showing project context.","findings":[]}',
    memory_pulled: [],
    specs_read: injected.map((d) => ({
      path: d.path,
      tokens: d.tokens,
      status: 'injected' as const,
      origin: 'agent' as const,
    })),
    project_context: { commit_sha: null, injected_tokens: injectedTokens, soft_cap_exceeded: false },
    log: [],
  };
  await db.insert(t.runTraces).values({ runId: SEED_PROJECT_CONTEXT_RUN_ID, trace }).onConflictDoNothing();
}

// CLI entrypoint
// pathToFileURL keeps the check true on Windows (`file:///C:/…` vs `C:\…`).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}