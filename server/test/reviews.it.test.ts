import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';
import { SCOPE_INSTRUCTIONS } from '@devdigest/reviewer-core';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts (line 11 added) so grounding can keep a
 * finding on line 11 and drop one on line 999 / a non-existent file.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture: one valid finding (line 11), one hallucinated (line 999). */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-halluc',
      severity: 'WARNING',
      category: 'bug',
      title: 'Phantom finding on a line not in the diff',
      file: 'src/config.ts',
      start_line: 999,
      end_line: 999,
      rationale: 'This line does not exist in the diff.',
      confidence: 0.5,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `payments-api-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Add rate limiting. Closes #471. The logging refactor is out of scope.',
    })
    .returning();
  // persist the patch so the reviewer can reconstruct a diff (MockGit also returns one)
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('A2 reviews + agents (Testcontainers pg)', () => {
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

  function appWith(structured: unknown, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [provider]: new MockLLMProvider(provider, { structured }),
        },
      },
    });
  }

  it('agents CRUD', async () => {
    const app = await appWith(REVIEW_FIXTURE);

    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Test Reviewer',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a reviewer.',
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json();
    expect(agent.version).toBe(1);

    const list = (await app.inject({ method: 'GET', url: '/agents' })).json();
    expect(list.some((a: { id: string }) => a.id === agent.id)).toBe(true);

    // a config change bumps version
    const updated = (
      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'Updated prompt.' },
      })
    ).json();
    expect(updated.version).toBe(2);

    await app.close();
  });

  it('runs a review: map-reduce + grounding drops the hallucinated finding, keeps the valid one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Sec', provider: 'openai', model: 'gpt-4.1', system_prompt: 'sec' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);

    // runReview is fire-and-forget: wait for the background run, then read the
    // persisted reviews (the POST returns runIds, not the reviews themselves).
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews).toHaveLength(1);

    const review = reviews[0];
    expect(review.verdict).toBe('request_changes');
    // Score is derived from the GROUNDED findings, not the model's self-reported
    // 42: grounding keeps one CRITICAL (line 11) ⇒ 100 − 35 = 65.
    expect(review.score).toBe(65);
    // grounding kept only the valid finding (line 11), dropped the line-999 one
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].file).toBe('src/config.ts');
    expect(review.findings[0].start_line).toBe(11);

    // a run_traces document was written (single doc)
    const runId = body.runs[0].run_id;
    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.config.model).toBe('gpt-4.1');
    expect(trace.stats.grounding).toBe('1/2 passed');
    expect(trace.log.length).toBeGreaterThan(0);

    // agent_runs row populated for A5 to aggregate
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('done');
    expect(run!.findingsCount).toBe(1);
    expect(run!.grounding).toBe('1/2 passed');

    await app.close();
  });

  it('dual-provider structured output: anthropic provider returns the same Review shape', async () => {
    const app = await appWith(REVIEW_FIXTURE, 'anthropic');
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Claude Rev', provider: 'anthropic', model: 'claude-x', system_prompt: 'rev' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    expect(reviews[0].findings).toHaveLength(1);
    expect(reviews[0].model).toBe('claude-x');
    await app.close();
  });

  it('finding actions: accept, dismiss', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ActAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })
    ).json();
    const findingId = reviews[0].findings[0].id;

    const accepted = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/accept` })
    ).json();
    expect(accepted.finding.accepted_at).not.toBeNull();

    const dismissed = (
      await app.inject({ method: 'POST', url: `/findings/${findingId}/dismiss` })
    ).json();
    expect(dismissed.finding.dismissed_at).not.toBeNull();
    expect(dismissed.finding.accepted_at).toBeNull();

    await app.close();
  });

  it('SSE: /runs/:id/events streams events and completes', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SseAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    // The run is synchronous; events are buffered on the bus. Subscribing after
    // the run still replays the buffer (replay-first semantics), then completes.
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;

    const sse = await app.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(sse.statusCode).toBe(200);
    expect(sse.headers['content-type']).toContain('text/event-stream');
    // The replay buffer should contain our log lines as SSE `data:` frames.
    expect(sse.payload).toContain('Starting review');
    expect(sse.payload).toContain('Citation grounding');
    await app.close();
  });

  it('linked+enabled skill lands in prompt_assembly.skills and skills_meta', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SkillfulAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: {
          name: 'coverage-gap-rubric',
          description: 'Flags untested branches',
          type: 'rubric',
          body: 'Flag any changed branch not covered by the accompanying test diff.',
        },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_id: skill.id },
    });

    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.skills).toContain(skill.body);
    expect(trace.prompt_assembly.skills_meta).toHaveLength(1);
    expect(trace.prompt_assembly.skills_meta[0].skill_id).toBe(skill.id);
    expect(trace.prompt_assembly.skills_meta[0].name).toBe('coverage-gap-rubric');
    expect(trace.prompt_assembly.skills_meta[0].tokens).toBeGreaterThan(0);

    await app.close();
  });

  it('deleting a run reverts the PR to needs_review (lastReviewedSha was stale otherwise)', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'DeleteMe', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } })
    ).json();
    const runId = body.runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const listedBefore = (
      await app.inject({ method: 'GET', url: `/repos/${pr.repoId}/pulls` })
    ).json() as { id: string; status: string; score: number | null }[];
    const before = listedBefore.find((p) => p.id === pr.id)!;
    expect(before.status).toBe('reviewed');
    expect(before.score).not.toBeNull();

    const del = await app.inject({ method: 'DELETE', url: `/runs/${runId}` });
    expect(del.statusCode).toBe(200);

    const listedAfter = (
      await app.inject({ method: 'GET', url: `/repos/${pr.repoId}/pulls` })
    ).json() as { id: string; status: string; score: number | null }[];
    const after = listedAfter.find((p) => p.id === pr.id)!;
    expect(after.status).toBe('needs_review');
    expect(after.score).toBeNull();

    await app.close();
  });

  it('run all enabled agents reviews with each enabled agent', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const body = (
      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { all: true } })
    ).json();
    // seed has 2 enabled agents; we may have created more above in this PR's ws.
    expect(body.runs.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  it('PR-list FINDINGS column sums each agent\'s latest review, not just one', async () => {
    const app = await appWith(REVIEW_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agentA = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'AgentA', provider: 'openai', model: 'gpt-4.1', system_prompt: 'a' },
      })
    ).json();
    const agentB = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'AgentB', provider: 'openai', model: 'gpt-4.1', system_prompt: 'b' },
      })
    ).json();

    // Both agents run against the same MockLLMProvider fixture, which keeps
    // exactly 1 grounded finding (the other is dropped as hallucinated) —
    // so 2 agents having reviewed should total 2 kept findings, not 1.
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agentA.id } });
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agentB.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });

    const listed = (
      await app.inject({ method: 'GET', url: `/repos/${pr.repoId}/pulls` })
    ).json() as { id: string; findings: { severity_counts: Record<string, number> } | null }[];
    const row = listed.find((p) => p.id === pr.id)!;
    expect(row.findings).not.toBeNull();
    const total = Object.values(row.findings!.severity_counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(2);

    await app.close();
  });

  it('scope: intent derives, scope persisted/returned, code overrides critical-on-changed, out hidden from counts', async () => {
    const INTENT = {
      summary: 'Add rate limiting',
      in_scope: ['rate limiting config'],
      out_of_scope: ['logging refactor'],
      confidence: 0.9,
      sources: [],
      missing_context: [],
    };
    const mk = (id: string, severity: 'CRITICAL' | 'WARNING', line: number, scope: 'in' | 'out') => ({
      id,
      severity,
      category: 'bug' as const,
      title: `finding ${id}`,
      file: 'src/config.ts',
      start_line: line,
      end_line: line,
      rationale: 'r',
      confidence: 0.9,
      kind: 'finding' as const,
      scope,
      scope_reason: scope === 'out' ? 'unrelated to the PR intent' : 'part of the change',
    });
    // line 11 is the added line; line 10 is context (unchanged).
    const SCOPED: Review = {
      verdict: 'comment',
      summary: 'ok',
      score: 80,
      findings: [mk('crit-added', 'CRITICAL', 11, 'out'), mk('warn-out', 'WARNING', 10, 'out')],
    };
    const mockOpenai = new MockLLMProvider('openai', { structuredBySchema: { Review: SCOPED } });
    const mockRouter = new MockLLMProvider('openai', { structuredBySchema: { Intent: INTENT } });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: mockOpenai, openrouter: mockRouter },
      },
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'ScopeAgent',
          provider: 'openai',
          model: 'gpt-4.1',
          system_prompt: 's',
          strategy: 'single-pass',
        },
      })
    ).json();
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // intent + review = exactly 2 structured calls for a single-pass run
    const structuredCalls = [...mockOpenai.calls, ...mockRouter.calls].filter(
      (c) => c.method === 'completeStructured',
    );
    expect(structuredCalls).toHaveLength(2);

    // The Review call actually carries the derived intent + scope instructions.
    const reviewReq = mockOpenai.calls.find(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Review',
    )!.req as { messages: { role: string; content: string }[] };
    const sysMsg = reviewReq.messages.find((m) => m.role === 'system')!.content;
    const userMsg = reviewReq.messages
      .filter((m) => m.role !== 'system')
      .map((m) => m.content)
      .join('\n');
    expect(userMsg).toMatch(
      /## Intent\n<untrusted source="intent">\n[\s\S]*Add rate limiting[\s\S]*<\/untrusted>/,
    );
    expect(userMsg).toContain('rate limiting config');
    expect(userMsg).toContain('logging refactor');
    expect(sysMsg).toContain(SCOPE_INSTRUCTIONS);

    // DB rows carry scope; CRITICAL on a changed line was forced to 'in'
    const [review] = await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.prId, pr.id));
    const rows = await pg.handle.db.select().from(t.findings).where(eq(t.findings.reviewId, review!.id));
    expect(rows).toHaveLength(2);
    const crit = rows.find((r) => r.severity === 'CRITICAL')!;
    const warn = rows.find((r) => r.severity === 'WARNING')!;
    expect(crit.scope).toBe('in');
    expect(crit.scopeReason).toBeTruthy();
    expect(warn.scope).toBe('out');
    expect(warn.scopeReason).toBeTruthy();

    // GET reviews exposes scope + scope_reason
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    const dtoWarn = reviews[0].findings.find((f: { severity: string }) => f.severity === 'WARNING');
    expect(dtoWarn.scope).toBe('out');
    expect(dtoWarn.scope_reason).toBeTruthy();

    // verdict/score from in-scope only: one CRITICAL ⇒ 65; run stats count only 'in'
    expect(reviews[0].score).toBe(65);
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.findingsCount).toBe(1);
    expect(run!.blockers).toBe(1);

    // smart-diff: the out finding's line (10) is absent, the in line (11) present
    const sd = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` })).json();
    const lines = sd.groups.flatMap((g: { files: { finding_lines: number[] }[] }) =>
      g.files.flatMap((f) => f.finding_lines),
    );
    expect(lines).toContain(11);
    expect(lines).not.toContain(10);

    // PR-list FINDINGS column excludes the out finding
    const listed = (await app.inject({ method: 'GET', url: `/repos/${pr.repoId}/pulls` })).json() as {
      id: string;
      findings: { severity_counts: Record<string, number> } | null;
    }[];
    const counts = listed.find((p) => p.id === pr.id)!.findings!.severity_counts;
    expect(counts).toEqual({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 });

    await app.close();
  });
  describe('scope policy end-to-end edge cases', () => {
    const INTENT = {
      summary: 'Add rate limiting',
      in_scope: ['rate limiting config'],
      out_of_scope: ['logging refactor'],
      confidence: 0.9,
      sources: [],
      missing_context: [],
    };
    const mkFinding = (over: Record<string, unknown>) => ({
      id: 'x',
      severity: 'CRITICAL' as const,
      category: 'bug' as const,
      title: 'finding x',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'r',
      confidence: 0.9,
      kind: 'finding' as const,
      scope: 'out' as const,
      scope_reason: 'unrelated to the PR intent',
      ...over,
    });

    async function runScoped(findings: unknown[]) {
      const review = { verdict: 'request_changes', summary: 'ok', score: 50, findings };
      const app = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: {
          embedder: new MockEmbedder(),
          git: new MockGitClient({ diff: DIFF }),
          llm: {
            openai: new MockLLMProvider('openai', { structuredBySchema: { Review: review } }),
            openrouter: new MockLLMProvider('openai', { structuredBySchema: { Intent: INTENT } }),
          },
        },
      });
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'EdgeAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's', strategy: 'single-pass' },
        })
      ).json();
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
      const runId = res.json().runs[0].run_id;
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
      const [rev] = await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.prId, pr.id));
      const rows = await pg.handle.db.select().from(t.findings).where(eq(t.findings.reviewId, rev!.id));
      const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
      const sd = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` })).json();
      const lines: number[] = sd.groups.flatMap((g: { files: { finding_lines: number[] }[] }) =>
        g.files.flatMap((f) => f.finding_lines),
      );
      const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
      await app.close();
      return { rows, run: run!, lines, reviews, rev: rev! };
    }

    it('CRITICAL on a CONTEXT line inside a hunk marked out stays in (changed lines include hunk context)', async () => {
      // line 10 is unchanged context, but within the hunk's new-side range 10-13
      const { rows, run, lines } = await runScoped([mkFinding({ id: 'ctx-crit', start_line: 10, end_line: 10 })]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.scope).toBe('in');
      expect(run.findingsCount).toBe(1);
      expect(run.blockers).toBe(1);
      expect(lines).toContain(10);
    });

    it('CRITICAL with a full-file kind outside the hunks marked out becomes the signal: persisted, not counted, visible in smart-diff', async () => {
      const { rows, run, lines, reviews, rev } = await runScoped([
        mkFinding({ id: 'far-crit', kind: 'phantom', start_line: 500, end_line: 500 }),
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.scope).toBe('signal');
      expect(rows[0]!.scopeReason).toBeTruthy();
      expect(run.findingsCount).toBe(0);
      expect(run.blockers).toBe(0);
      expect(reviews[0].findings.find((f: { scope: string }) => f.scope === 'signal')).toBeTruthy();
      expect(rev.verdict).toBe('approve');
      expect(lines).toContain(500);
    });
  });
});
