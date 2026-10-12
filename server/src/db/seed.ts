import 'dotenv/config';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and, asc, inArray, isNull, sql } from 'drizzle-orm';
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
import { PROJECT_DOCS_FIXTURE, PROJECT_DOCS_FIXTURE_SHA } from './fixtures/project-docs.js';
import {
  type SeedEvalCase,
  SEED_EVAL_CASES_BY_AGENT,
  SEED_EVAL_PROMPT_V2_SUFFIX,
  SEED_EVAL_RUNS,
  SEED_EVAL_RUN_V1_ID,
  SEED_EVAL_RUN_V2_ID,
} from './fixtures/eval-cases.js';
import { buildManifest, versionConfigOf } from '../platform/agent-config.js';

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

export interface SeedOptions {
  /**
   * Attach the demo documents (SEED_CONTEXT_PATHS) to Security Reviewer. Only meaningful with the
   * fixture docs source (PROJECT_DOCS_SOURCE=fixture): against a real repository those paths do
   * not exist on main and every run would skip them as not_found.
   */
  demoContext?: boolean;
}

export async function seed(db: Db, opts: SeedOptions = {}): Promise<{ workspaceId: string; userId: string }> {
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
    if (opts.demoContext && securityAgent.contextPaths.length === 0) {
      await db.update(t.agents).set({ contextPaths: SEED_CONTEXT_PATHS }).where(eq(t.agents.id, securityAgent.id));
    }
    if (pr482) {
      await seedProjectContextRun(db, { workspaceId, prId: pr482.id, prNumber: pr482.number, agent: securityAgent });
    }
  }
  for (const [agentName, cases] of Object.entries(SEED_EVAL_CASES_BY_AGENT)) {
    const [agent] = await db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (agent) await seedEvalCases(db, { workspaceId, agentId: agent.id, prId: pr482?.id ?? null }, cases);
  }
  if (securityAgent && opts.demoContext) await seedEvalFixtureRuns(db, { workspaceId, agentId: securityAgent.id });
  if (opts.demoContext) await applyFixtureDecisions(db);

  return { workspaceId, userId };
}

/** Title and file of the seeded sample finding that the fixture marks accepted (SPEC-03 OQ-11). */
const FIXTURE_ACCEPTED_FINDING = { file: 'src/config.ts', title: 'Hardcoded Stripe secret key in commit' };

/** Id of the seeded sample finding (review model "seed") with this file and title, if it still exists. */
async function findSeedFinding(db: Db, file: string, title: string): Promise<string | undefined> {
  const [row] = await db
    .select({ id: t.findings.id })
    .from(t.findings)
    .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
    .where(and(eq(t.reviews.model, 'seed'), eq(t.findings.file, file), eq(t.findings.title, title)));
  return row?.id;
}

/**
 * Fixture mode only: the seeded Stripe finding is shown as accepted so a "Turn into eval case"
 * flow has a decided finding. Never overrides a decision already made; `resetDemoProject` clears
 * the marks on every dev boot and calls this again. The N+1 finding stays undecided.
 */
export async function applyFixtureDecisions(db: Db): Promise<void> {
  const id = await findSeedFinding(db, FIXTURE_ACCEPTED_FINDING.file, FIXTURE_ACCEPTED_FINDING.title);
  if (!id) return;
  await db
    .update(t.findings)
    .set({ acceptedAt: new Date() })
    .where(and(eq(t.findings.id, id), isNull(t.findings.acceptedAt), isNull(t.findings.dismissedAt)));
}

/**
 * Seeded eval cases of one built-in agent. Inserted only while the agent has no seeded-origin
 * case (origin "seeded" or a seed_key), so a case the user deleted is never re-created (OQ-10)
 * and a second run adds nothing. Derived cases link to the seeded sample findings when present.
 * Existing cases that carry a fixture `seed_key` are healed in place: `expected_output` and
 * `input_diff` are rewritten to the fixture value when they differ (cases without a seed_key are
 * never touched, and nothing is inserted on that path).
 */
async function seedEvalCases(
  db: Db,
  a: { workspaceId: string; agentId: string; prId: string | null },
  cases: SeedEvalCase[],
): Promise<void> {
  // Resolved before the transaction (read-only lookups of the seeded sample findings).
  const sourceFindingIds = new Map<string, string | undefined>();
  for (const c of cases) {
    sourceFindingIds.set(
      c.seed_key,
      c.derived_from ? await findSeedFinding(db, c.derived_from.file, c.derived_from.title) : undefined,
    );
  }

  // The check and the inserts run under one advisory lock per agent: a dev server restart seeds on
  // boot, and a manual `db:seed` at the same moment must not add the set twice.
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`seed_eval_cases:${a.agentId}`}))`);
    const present = await tx
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, a.workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, a.agentId),
          sql`(${t.evalCases.inputMeta}->>'origin' = 'seeded' or ${t.evalCases.inputMeta}->>'seed_key' is not null)`,
        ),
      )
      .limit(1);
    if (present.length > 0) {
      for (const c of cases) {
        await tx
          .update(t.evalCases)
          .set({ expectedOutput: c.expectation, inputDiff: c.input_diff })
          .where(
            and(
              eq(t.evalCases.workspaceId, a.workspaceId),
              eq(t.evalCases.ownerKind, 'agent'),
              eq(t.evalCases.ownerId, a.agentId),
              sql`${t.evalCases.inputMeta}->>'seed_key' = ${c.seed_key}`,
              sql`(${t.evalCases.expectedOutput} is distinct from ${JSON.stringify(c.expectation)}::jsonb or ${t.evalCases.inputDiff} is distinct from ${c.input_diff})`,
            ),
          );
      }
      return;
    }

    for (const c of cases) {
      const sourceFindingId = sourceFindingIds.get(c.seed_key);
      await tx
        .insert(t.evalCases)
        .values({
          workspaceId: a.workspaceId,
          ownerKind: 'agent',
          ownerId: a.agentId,
          name: c.name,
          inputDiff: c.input_diff,
          inputMeta: {
            origin: c.origin,
            seed_key: c.seed_key,
            ...(sourceFindingId
              ? { source_finding_id: sourceFindingId, source_pr_id: a.prId, source_decision: c.derived_from!.decision }
              : {}),
          },
          expectedOutput: c.expectation,
          notes: null,
        })
        // A user-made case for the same finding wins (unique per owner and source finding).
        .onConflictDoNothing();
    }
  });
}

/**
 * Fixture mode only (A-3): bump Security Reviewer from v1 to v2 (prompt + one-sentence suffix, with
 * agent_versions snapshots) and insert the two finished suite runs. Skipped once either seeded run
 * exists; the bump itself happens only while the agent is still at v1.
 */
async function seedEvalFixtureRuns(db: Db, a: { workspaceId: string; agentId: string }): Promise<void> {
  const [done] = await db
    .select({ id: t.evalSuiteRuns.id })
    .from(t.evalSuiteRuns)
    .where(inArray(t.evalSuiteRuns.id, [SEED_EVAL_RUN_V1_ID, SEED_EVAL_RUN_V2_ID]));
  if (done) return;

  await db.transaction(async (tx) => {
    let [agent] = await tx.select().from(t.agents).where(eq(t.agents.id, a.agentId));
    if (!agent) return;
    const links = await tx
      .select({ skillId: t.agentSkills.skillId })
      .from(t.agentSkills)
      .where(eq(t.agentSkills.agentId, agent.id))
      .orderBy(asc(t.agentSkills.order));
    const skillIds = links.map((l) => l.skillId);

    if (agent.version === 1) {
      await tx
        .insert(t.agentVersions)
        .values({ agentId: agent.id, version: 1, configJson: versionConfigOf(agent, skillIds) })
        .onConflictDoNothing();
      [agent] = await tx
        .update(t.agents)
        .set({ systemPrompt: agent.systemPrompt + SEED_EVAL_PROMPT_V2_SUFFIX, version: 2 })
        .where(eq(t.agents.id, a.agentId))
        .returning();
      await tx
        .insert(t.agentVersions)
        .values({ agentId: a.agentId, version: 2, configJson: versionConfigOf(agent!, skillIds) })
        .onConflictDoNothing();
    }

    // The manifests freeze the shipped prompt (v1) and prompt + suffix (v2), whatever the agent is now.
    const manifestFor = (version: 1 | 2) =>
      buildManifest(
        {
          ...agent!,
          systemPrompt: version === 1 ? SECURITY_REVIEWER_PROMPT : SECURITY_REVIEWER_PROMPT + SEED_EVAL_PROMPT_V2_SUFFIX,
        },
        skillIds,
        [],
      );

    const caseRows = await tx
      .select({ id: t.evalCases.id, seedKey: sql<string | null>`${t.evalCases.inputMeta}->>'seed_key'` })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerKind, 'agent'), eq(t.evalCases.ownerId, a.agentId)));
    const caseIdByKey = new Map(caseRows.filter((r) => r.seedKey).map((r) => [r.seedKey!, r.id]));

    for (const r of SEED_EVAL_RUNS) {
      await tx.insert(t.evalSuiteRuns).values({
        id: r.id,
        workspaceId: a.workspaceId,
        agentId: a.agentId,
        agentVersion: r.agent_version,
        manifest: manifestFor(r.agent_version),
        status: r.status,
        casesTotal: r.results.length,
        recall: r.metrics.recall,
        precision: r.metrics.precision,
        citationAccuracy: r.metrics.citation_accuracy,
        counts: r.counts,
        durationMs: r.duration_ms,
        costUsd: r.cost_usd,
        startedAt: new Date(r.started_at),
        finishedAt: new Date(r.finished_at),
      });
      await tx.insert(t.evalRuns).values(
        r.results.map((x) => ({
          id: x.id,
          // A case the user deleted leaves the historical row without a link (case_id set null).
          caseId: caseIdByKey.get(x.seed_key) ?? null,
          suiteRunId: r.id,
          status: x.status,
          caseSnapshot: { name: x.case_name, expectation: x.expectation, origin: x.origin },
          error: x.error,
          tokensIn: x.tokens_in,
          tokensOut: x.tokens_out,
          ranAt: new Date(r.started_at),
          actualOutput: { grounded: x.grounded, dropped: x.dropped },
          pass: x.pass,
          durationMs: x.duration_ms,
          costUsd: x.cost_usd,
        })),
      );
    }
  });
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
    project_context: { commit_sha: PROJECT_DOCS_FIXTURE_SHA, injected_tokens: injectedTokens, soft_cap_exceeded: false },
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
  seed(handle.db, { demoContext: process.env.PROJECT_DOCS_SOURCE === 'fixture' })
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