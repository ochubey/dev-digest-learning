import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';
import { SEED_PROJECT_CONTEXT_RUN_ID } from './seed.js';

/** The fictional demo repo created by `seed()`. The reset only ever touches this repo. */
export const DEMO_REPO_FULL_NAME = 'acme/payments-api';
/** `reviews.model` marker of the sample reviews written by `seed()` (kept by the reset). */
const SEED_REVIEW_MODEL = 'seed';

/**
 * Return the seeded demo project to its pristine state: delete everything that was produced by
 * analysing it (Intents, agent runs + traces, briefs, composed/multi-agent runs, conformance
 * checks, and every review that did not come from the seed), clear accept/dismiss marks and scope
 * labels on the seed's own sample findings, and forget which commit was last reviewed.
 *
 * What `seed()` creates (repo, PRs, files + patches, sample reviews + findings, agents) stays.
 * Other repos are never touched. Idempotent. Call after `seed()` so the baseline exists.
 */
export async function resetDemoProject(db: Db): Promise<{ pulls: number }> {
  const repos = await db
    .select({ id: t.repos.id })
    .from(t.repos)
    .where(eq(t.repos.fullName, DEMO_REPO_FULL_NAME));
  if (repos.length === 0) return { pulls: 0 };

  const prs = await db
    .select({ id: t.pullRequests.id })
    .from(t.pullRequests)
    .where(inArray(t.pullRequests.repoId, repos.map((r) => r.id)));
  const prIds = prs.map((p) => p.id);
  if (prIds.length === 0) return { pulls: 0 };

  await db.transaction(async (tx) => {
    await tx.delete(t.prIntent).where(inArray(t.prIntent.prId, prIds));
    await tx.delete(t.prBrief).where(inArray(t.prBrief.prId, prIds));
    await tx.delete(t.composedReviews).where(inArray(t.composedReviews.prId, prIds));
    await tx.delete(t.conformanceChecks).where(inArray(t.conformanceChecks.prId, prIds));
    await tx.delete(t.multiAgentRuns).where(inArray(t.multiAgentRuns.prId, prIds));
    // Reviews from real agents (findings cascade); the seed's sample reviews stay.
    await tx
      .delete(t.reviews)
      .where(
        and(
          inArray(t.reviews.prId, prIds),
          or(isNull(t.reviews.model), ne(t.reviews.model, SEED_REVIEW_MODEL)),
        ),
      );

    // After the reviews (a review may point at its run); run_traces cascade. The seeded
    // project-context run is part of the baseline and stays.
    await tx
      .delete(t.agentRuns)
      .where(and(inArray(t.agentRuns.prId, prIds), ne(t.agentRuns.id, SEED_PROJECT_CONTEXT_RUN_ID)));

    const seedReviews = await tx
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.model, SEED_REVIEW_MODEL)));
    if (seedReviews.length > 0) {
      await tx
        .update(t.findings)
        .set({ acceptedAt: null, dismissedAt: null, scope: null, scopeReason: null })
        .where(inArray(t.findings.reviewId, seedReviews.map((r) => r.id)));
    }

    await tx
      .update(t.pullRequests)
      .set({ lastReviewedSha: null, status: 'needs_review' })
      .where(inArray(t.pullRequests.id, prIds));
  });

  return { pulls: prIds.length };
}
