/**
 * Skills feature — control-experiment verification.
 *
 * This does NOT prove a real LLM reasons better with skills attached (that
 * needs actual model calls, which this no-Docker/no-API-key sandbox can't
 * make). What it proves: the skills -> prompt -> findings WIRING is live and
 * correct — a skill linked+enabled on an agent genuinely reaches the model's
 * prompt, and the exact same run-executor code path is exercised with and
 * without it. The mock LLM below is prompt-CONDITIONAL (reads the assembled
 * messages and only returns the skill-informed finding when it can see the
 * skill's own marker text in them) rather than a fixed canned response, so a
 * passing test is real evidence the skill body actually arrived in the
 * request, not just that the endpoint returns 200.
 *
 * Two scenarios, matching the two requested control experiments:
 *  1. Test Quality Reviewer: a PR whose diff adds a function with an
 *     unguarded branch, and only a happy-path test. Without skills, the mock
 *     (standing in for a model that hasn't been told to look for coverage
 *     gaps) returns no findings. With the 4 linked skills, the mock detects
 *     its own coverage-gap-rubric marker text in the prompt and returns a
 *     finding for the untested branch + missed corner case.
 *  2. API Contract Reviewer: a PR that removes a required parameter from a
 *     route handler (a breaking signature change). Without the
 *     breaking-change-detector skill, no findings; with it linked, one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type {
  ChatMessage,
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  Review,
} from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const NO_FINDINGS: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 90,
  findings: [],
};

/**
 * A prompt-conditional mock: scans the assembled `messages` for `markerText`
 * (a distinctive substring of the relevant skill's body) and returns
 * `withSkillFindings` only when it's present, `NO_FINDINGS` otherwise. This
 * is what makes the test a genuine wiring check rather than a canned 200.
 */
class MarkerConditionalLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic' = 'openai';
  constructor(
    private markerText: string,
    private withSkillFindings: Review,
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    return { text: 'mock', model: 'gpt-4.1', tokensIn: 10, tokensOut: 5, costUsd: 0 };
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const promptText = req.messages.map((m: ChatMessage) => m.content).join('\n');
    const sawSkill = promptText.includes(this.markerText);
    const data = (sawSkill ? this.withSkillFindings : NO_FINDINGS) as unknown as T;
    return {
      data,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(data),
      attempts: 1,
    };
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0]);
  }
}

// ---- Skill bodies (each has a distinctive marker phrase the mock LLM keys on) ----

const COVERAGE_GAP_MARKER = 'MARKER-COVERAGE-GAP-RUBRIC';
const COVERAGE_GAP_BODY = `# Coverage gap rubric (${COVERAGE_GAP_MARKER})
Flag any changed branch (new conditional, new error path) not exercised by
the accompanying test diff.`;

const CORNER_CASE_BODY = `# Corner case checklist
Check for: empty/null input, boundary values (0, -1, max), duplicate/
concurrent calls, missing error-path assertions.`;

const NO_OVER_MOCKING_BODY = `# No over-mocking
Flag tests that mock so much of the system under test that the test no
longer verifies real behavior.`;

// This one is created via the real import flow (preview -> confirm), not a
// direct POST /skills — exercises the whole import code path end to end.
const FLAKY_TEST_MD = `---
name: flaky-test-patterns
type: custom
description: Detects non-deterministic test patterns
---
# Flaky test patterns
Detect unseeded randomness, real timers without fake-timer control, real
network/filesystem calls, and order-dependent shared state between tests.`;

const BREAKING_CHANGE_MARKER = 'MARKER-BREAKING-CHANGE-DETECTOR';
const BREAKING_CHANGE_BODY = `# Breaking-change detector (${BREAKING_CHANGE_MARKER})
Flag route/handler signature changes that remove or rename a required
parameter, or change a response shape callers rely on.`;

const HAPPY_PATH_TEST_DIFF = `diff --git a/src/modules/orders/service.ts b/src/modules/orders/service.ts
--- a/src/modules/orders/service.ts
+++ b/src/modules/orders/service.ts
@@ -10,6 +10,12 @@
   async cancelOrder(id: string, reason?: string) {
     const order = await this.repo.get(id);
+    if (order.status === 'shipped') {
+      throw new ConflictError('Cannot cancel a shipped order');
+    }
     return this.repo.update(id, { status: 'cancelled', reason });
   }
diff --git a/src/modules/orders/service.test.ts b/src/modules/orders/service.test.ts
--- a/src/modules/orders/service.test.ts
+++ b/src/modules/orders/service.test.ts
@@ -1,3 +1,8 @@
+it('cancels a pending order', async () => {
+  const result = await service.cancelOrder('ord_1');
+  expect(result.status).toBe('cancelled');
+});`;

const BREAKING_ROUTE_DIFF = `diff --git a/src/modules/orders/routes.ts b/src/modules/orders/routes.ts
--- a/src/modules/orders/routes.ts
+++ b/src/modules/orders/routes.ts
@@ -14,6 +14,6 @@
-  app.post('/orders/:id/cancel', async (req) => {
-    return service.cancelOrder(req.params.id, req.body.reason);
+  app.post('/orders/:id/cancel', async (req) => {
+    return service.cancelOrder(req.params.id);
   });`;

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string, diff: string, patch: string) {
  const name = `skills-control-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 1,
      title: 'control experiment PR',
      author: 'marisa.koch',
      branch: 'feat/x',
      base: 'main',
      headSha: 'deadbeef',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/modules/orders/service.ts',
    additions: 1,
    deletions: 0,
    patch,
  });
  return { repo: repo!, pr: pr!, diff };
}

d('Skills control experiments (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(diff: string, llm: LLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff }),
        llm: { openai: llm },
      },
    });
  }

  it('Test Quality Reviewer: no findings without skills, flags coverage gap + corner case with them', async () => {
    const llm = new MarkerConditionalLLMProvider(COVERAGE_GAP_MARKER, {
      verdict: 'request_changes',
      summary: 'Untested error branch and missing corner-case coverage.',
      score: 55,
      findings: [
        {
          id: 'f-coverage-gap',
          severity: 'WARNING',
          category: 'test-coverage',
          title: 'New error branch is not covered by a test',
          file: 'src/modules/orders/service.ts',
          start_line: 13,
          end_line: 13,
          rationale: 'The new ConflictError branch has no corresponding test case.',
          suggestion: 'Add a test that cancels an already-shipped order.',
          confidence: 0.9,
          kind: 'finding',
        },
        {
          id: 'f-corner-case',
          severity: 'SUGGESTION',
          category: 'test-coverage',
          title: 'No test for a non-existent order id',
          file: 'src/modules/orders/service.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'cancelOrder with an unknown id is a common corner case, untested here.',
          confidence: 0.7,
          kind: 'finding',
        },
      ],
    });

    // ---- Step 1: seed the agent + 4 skills, one via the real import flow ----
    const appForSetup = await appWith(HAPPY_PATH_TEST_DIFF, llm);
    const agent = (
      await appForSetup.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Test Quality Reviewer',
          description:
            'Reviews test changes for coverage gaps, missed edge cases, over-mocking, and flaky patterns.',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt:
            'You review TEST CODE changes only. Judge coverage, edge-case handling, mock usage, and determinism.',
        },
      })
    ).json();

    const coverageGapSkill = (
      await appForSetup.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'coverage-gap-rubric',
          description: 'Flags changed branches not exercised by the test diff',
          type: 'rubric',
          body: COVERAGE_GAP_BODY,
        },
      })
    ).json();
    const cornerCaseSkill = (
      await appForSetup.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'corner-case-checklist',
          description: 'House checklist for commonly-missed edge cases',
          type: 'convention',
          body: CORNER_CASE_BODY,
        },
      })
    ).json();
    const noOverMockingSkill = (
      await appForSetup.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'no-over-mocking',
          description: 'Flags tests that mock away the behavior under test',
          type: 'convention',
          body: NO_OVER_MOCKING_BODY,
        },
      })
    ).json();

    // Fourth skill: through the REAL import UI flow (preview, never writes to
    // the DB, then confirm) — not a direct POST /skills.
    const preview = (
      await appForSetup.inject({
        method: 'POST',
        url: '/skills/import/preview',
        payload: {
          filename: 'flaky-test-patterns.md',
          content_base64: Buffer.from(FLAKY_TEST_MD, 'utf-8').toString('base64'),
        },
      })
    ).json();
    expect(preview.name).toBe('flaky-test-patterns');
    expect(preview.type).toBe('custom');
    const flakySkill = (
      await appForSetup.inject({
        method: 'POST',
        url: '/skills/import',
        payload: preview,
      })
    ).json();
    expect(flakySkill.source).toBe('imported_file');

    // Link all 4, in the order from the spec's worked example (§7).
    await appForSetup.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: {
        skill_ids: [coverageGapSkill.id, cornerCaseSkill.id, noOverMockingSkill.id, flakySkill.id],
      },
    });
    await appForSetup.close();

    // ---- Step 2: WITHOUT skills — unlink them all, run, expect no findings ----
    const appWithout = await appWith(HAPPY_PATH_TEST_DIFF, llm);
    await appWithout.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [] },
    });
    const { pr: prA } = await setupRepoAndPr(
      pg.handle.db,
      workspaceId,
      HAPPY_PATH_TEST_DIFF,
      '@@ -10,6 +10,12 @@\n   async cancelOrder(id, reason) {',
    );
    const runWithout = (
      await appWithout.inject({
        method: 'POST',
        url: `/pulls/${prA.id}/review`,
        payload: { agentId: agent.id },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, prA.id, { expected: 1 });
    const traceWithout = (
      await appWithout.inject({ method: 'GET', url: `/runs/${runWithout.runs[0].run_id}/trace` })
    ).json();
    expect(traceWithout.prompt_assembly.skills).toBeNull();
    expect(traceWithout.stats.findings).toBe(0);
    await appWithout.close();

    // ---- Step 3: WITH skills re-linked — run again, expect the 2 findings ----
    const appWithSkills = await appWith(HAPPY_PATH_TEST_DIFF, llm);
    await appWithSkills.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: {
        skill_ids: [coverageGapSkill.id, cornerCaseSkill.id, noOverMockingSkill.id, flakySkill.id],
      },
    });
    const { pr: prB } = await setupRepoAndPr(
      pg.handle.db,
      workspaceId,
      HAPPY_PATH_TEST_DIFF,
      '@@ -10,6 +10,12 @@\n   async cancelOrder(id, reason) {',
    );
    const runWith = (
      await appWithSkills.inject({
        method: 'POST',
        url: `/pulls/${prB.id}/review`,
        payload: { agentId: agent.id },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, prB.id, { expected: 1 });
    const traceWith = (
      await appWithSkills.inject({ method: 'GET', url: `/runs/${runWith.runs[0].run_id}/trace` })
    ).json();
    expect(traceWith.prompt_assembly.skills).toContain(COVERAGE_GAP_MARKER);
    expect(traceWith.prompt_assembly.skills_meta).toHaveLength(4);
    expect(traceWith.stats.findings).toBe(2);

    const review = await pg.handle.db
      .select()
      .from(t.reviews)
      .where(eq(t.reviews.prId, prB.id));
    const findings = await pg.handle.db
      .select()
      .from(t.findings)
      .where(eq(t.findings.reviewId, review[0]!.id));
    expect(findings.map((f) => f.category)).toEqual(
      expect.arrayContaining(['test-coverage']),
    );
    await appWithSkills.close();
  });

  it('API Contract Reviewer: no findings without the skill, flags the breaking change with it', async () => {
    const llm = new MarkerConditionalLLMProvider(BREAKING_CHANGE_MARKER, {
      verdict: 'request_changes',
      summary: 'Removed a required parameter from a public route handler.',
      score: 30,
      findings: [
        {
          id: 'f-breaking-change',
          severity: 'CRITICAL',
          category: 'breaking-change',
          title: "Route handler dropped the required 'reason' parameter",
          file: 'src/modules/orders/routes.ts',
          start_line: 15,
          end_line: 16,
          rationale: 'Callers sending a reason will silently have it ignored — an API contract break.',
          suggestion: 'Keep the parameter, or version the endpoint.',
          confidence: 0.92,
          kind: 'finding',
        },
      ],
    });

    const appForSetup = await appWith(BREAKING_ROUTE_DIFF, llm);
    const agent = (
      await appForSetup.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'API Contract Reviewer',
          description: 'Flags breaking changes to route/handler signatures and response shapes.',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 'You review API route/handler changes for breaking-change risk.',
        },
      })
    ).json();
    const skill = (
      await appForSetup.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'breaking-change-detector',
          description: 'Flags removed/renamed params or changed response shapes',
          type: 'rubric',
          body: BREAKING_CHANGE_BODY,
        },
      })
    ).json();
    await appForSetup.close();

    // WITHOUT the skill
    const appWithout = await appWith(BREAKING_ROUTE_DIFF, llm);
    const { pr: prA } = await setupRepoAndPr(
      pg.handle.db,
      workspaceId,
      BREAKING_ROUTE_DIFF,
      '@@ -14,6 +14,6 @@\n   app.post(...)',
    );
    const runWithout = (
      await appWithout.inject({
        method: 'POST',
        url: `/pulls/${prA.id}/review`,
        payload: { agentId: agent.id },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, prA.id, { expected: 1 });
    const traceWithout = (
      await appWithout.inject({ method: 'GET', url: `/runs/${runWithout.runs[0].run_id}/trace` })
    ).json();
    expect(traceWithout.prompt_assembly.skills).toBeNull();
    expect(traceWithout.stats.findings).toBe(0);
    await appWithout.close();

    // WITH the skill linked
    const appWithSkill = await appWith(BREAKING_ROUTE_DIFF, llm);
    await appWithSkill.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_id: skill.id },
    });
    const { pr: prB } = await setupRepoAndPr(
      pg.handle.db,
      workspaceId,
      BREAKING_ROUTE_DIFF,
      '@@ -14,6 +14,6 @@\n   app.post(...)',
    );
    const runWith = (
      await appWithSkill.inject({
        method: 'POST',
        url: `/pulls/${prB.id}/review`,
        payload: { agentId: agent.id },
      })
    ).json();
    await waitForPrRuns(pg.handle.db, prB.id, { expected: 1 });
    const traceWith = (
      await appWithSkill.inject({ method: 'GET', url: `/runs/${runWith.runs[0].run_id}/trace` })
    ).json();
    expect(traceWith.prompt_assembly.skills).toContain(BREAKING_CHANGE_MARKER);
    expect(traceWith.stats.findings).toBe(1);
    await appWithSkill.close();
  });
});
