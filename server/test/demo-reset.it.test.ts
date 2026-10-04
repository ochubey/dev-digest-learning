import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import { resetDemoProject } from '../src/db/demo-reset.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('resetDemoProject (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const db = () => pg.handle.db;
  const pr = async (n: number) =>
    (await db().select().from(t.pullRequests).where(eq(t.pullRequests.number, n)))[0]!;
  const reviewsOf = async (prId: string) =>
    db().select().from(t.reviews).where(eq(t.reviews.prId, prId));

  it('wipes analysis on the demo PRs, keeps the seeded samples, resets marks, and never touches other repos', async () => {
    const p482 = await pr(482);
    const [agent] = await db().select().from(t.agents);

    // --- analysis produced by a user on the demo repo ---
    await db().insert(t.prIntent).values({ prId: p482.id, summary: 'derived', model: 'openai/x', confidence: 0.9 });
    await db().insert(t.prBrief).values({ prId: p482.id, json: { a: 1 } });
    const [run] = await db()
      .insert(t.agentRuns)
      .values({ workspaceId, agentId: agent!.id, prId: p482.id })
      .returning();
    const [real] = await db()
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: p482.id,
        kind: 'review',
        agentId: agent!.id,
        runId: run!.id,
        model: 'openai/gpt-4.1-mini',
        summary: 'real',
      } as never)
      .returning();
    await db().insert(t.findings).values({
      reviewId: real!.id,
      file: 'src/config.ts',
      startLine: 1,
      endLine: 1,
      severity: 'WARNING',
      category: 'bug',
      title: 'real finding',
      rationale: 'r',
      confidence: 0.8,
      scope: 'out',
    });
    await db()
      .update(t.pullRequests)
      .set({ lastReviewedSha: p482.headSha, status: 'reviewed' })
      .where(eq(t.pullRequests.id, p482.id));
    // marks + scope on the seed's own finding
    const seedReview = (await reviewsOf(p482.id)).find((r) => r.model === 'seed')!;
    await db()
      .update(t.findings)
      .set({ acceptedAt: new Date(), scope: 'signal', scopeReason: 'x' })
      .where(eq(t.findings.reviewId, seedReview.id));

    // --- an unrelated repo with its own analysis: must survive ---
    const [other] = await db()
      .insert(t.repos)
      .values({ workspaceId, owner: 'me', name: 'real-repo', fullName: 'me/real-repo', defaultBranch: 'main' })
      .returning();
    const [otherPr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: other!.id,
        number: 1,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'abc',
        lastReviewedSha: 'abc',
      })
      .returning();
    await db().insert(t.prIntent).values({ prId: otherPr!.id, summary: 'keep me', confidence: 0.7 });

    const res = await resetDemoProject(db());
    expect(res.pulls).toBe(2);

    // demo: analysis gone
    expect(await db().select().from(t.prIntent).where(eq(t.prIntent.prId, p482.id))).toEqual([]);
    expect(await db().select().from(t.prBrief).where(eq(t.prBrief.prId, p482.id))).toEqual([]);
    expect(await db().select().from(t.agentRuns).where(eq(t.agentRuns.prId, p482.id))).toEqual([]);
    expect((await reviewsOf(p482.id)).map((r) => r.model)).toEqual(['seed']);
    expect(await db().select().from(t.findings).where(eq(t.findings.reviewId, real!.id))).toEqual([]);
    const after = await pr(482);
    expect(after.lastReviewedSha).toBeNull();
    expect(after.status).toBe('needs_review');

    // demo: seeded samples stay, marks cleared
    const seeded = await db().select().from(t.findings).where(eq(t.findings.reviewId, seedReview.id));
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((f) => f.acceptedAt == null && f.dismissedAt == null && f.scope == null)).toBe(true);
    expect((await reviewsOf((await pr(483)).id)).map((r) => r.model)).toEqual(['seed']);

    // other repo untouched
    expect(
      (await db().select().from(t.prIntent).where(eq(t.prIntent.prId, otherPr!.id))).map((r) => r.summary),
    ).toEqual(['keep me']);
    expect(
      (await db().select().from(t.pullRequests).where(eq(t.pullRequests.id, otherPr!.id)))[0]!.lastReviewedSha,
    ).toBe('abc');
  });

  it('is idempotent and a no-op when the demo repo does not exist', async () => {
    expect((await resetDemoProject(db())).pulls).toBe(2);
    await db().delete(t.repos).where(eq(t.repos.fullName, 'acme/payments-api'));
    expect(await resetDemoProject(db())).toEqual({ pulls: 0 });
  });
});
