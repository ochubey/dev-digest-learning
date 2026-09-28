import { and, desc, eq, inArray } from 'drizzle-orm';
import type {
  PrMeta,
  PrDetail,
  GitHubClient,
  PrReviewComment,
  PrCommentInput as PrCommentInputType,
  Severity,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import type { Logger } from '../reviews/run-executor.js';
import * as t from '../../db/schema.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { deriveReviewStatus } from './status.js';

type FindingPreview = {
  severity: Severity;
  title: string;
  category: string;
  file: string;
  start_line: number;
  confidence: number;
};

/**
 * F1 — pulls service. PR import via Octokit (list + per-PR detail), inline
 * review-comment proxy. Import is idempotent (unique repo_id+number). Review
 * trigger is MANUAL and owned by A2 — this module only imports/reads.
 */
export class PullsService {
  constructor(private container: Container) {}

  async listPulls(workspaceId: string, repoId: string, logger?: Logger): Promise<PrMeta[]> {
    const { container } = this;
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    if (!repo) throw new NotFoundError('Repo not found');

    let gh: GitHubClient | null = null;
    try {
      gh = await container.github();
    } catch (err) {
      logger?.warn({ err }, 'GitHub client unavailable (no token / offline); serving persisted PRs');
    }

    // Local-first: sync from GitHub when a token is configured, but never
    // fail the read — already-imported/seeded PRs stay viewable offline.
    if (gh) {
      try {
        const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
        for (const pr of pulls) {
          await container.db
            .insert(t.pullRequests)
            .values({
              workspaceId,
              repoId: repo.id,
              number: pr.number,
              title: pr.title,
              author: pr.author,
              branch: pr.branch,
              base: pr.base,
              headSha: pr.head_sha,
              additions: pr.additions,
              deletions: pr.deletions,
              filesCount: pr.files_count,
              status: pr.status,
              openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
              updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
            })
            .onConflictDoUpdate({
              target: [t.pullRequests.repoId, t.pullRequests.number],
              set: {
                title: pr.title,
                headSha: pr.head_sha,
                status: pr.status,
                updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
              },
            });
        }
      } catch (err) {
        logger?.warn({ err }, 'GitHub PR sync skipped (no token / offline); serving persisted PRs');
      }
    }

    const rows = await container.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repo.id));

    // Diff stats aren't on GitHub's PR-list payload, so freshly-imported PRs
    // land with zeroed size/diff. Backfill them once from the detail endpoint
    // so the list shows real S/M/L + ± counts. Capped per request (each backfill
    // is a detail fetch) — the periodic refetch chips away at any remainder.
    const BACKFILL_LIMIT = 10;
    if (gh) {
      const needStats = rows
        .filter((r) => r.additions === 0 && r.deletions === 0 && r.filesCount === 0)
        .slice(0, BACKFILL_LIMIT);
      for (const r of needStats) {
        try {
          const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, r.number);
          await container.db
            .update(t.pullRequests)
            .set({
              additions: detail.additions,
              deletions: detail.deletions,
              filesCount: detail.files_count,
            })
            .where(eq(t.pullRequests.id, r.id));
          r.additions = detail.additions;
          r.deletions = detail.deletions;
          r.filesCount = detail.files_count;
        } catch (err) {
          logger?.warn({ err, number: r.number }, 'PR diff-stat backfill skipped');
        }
      }
    }

    // PR score = the average of each AGENT's latest review score (so a PR
    // reviewed by 3 agents isn't represented by whichever happened to run
    // last — a single request_changes agent still pulls the average down).
    // Cost = the SUM of every successful (status='done') run's cost for the
    // PR — a running total of what this PR has cost to review, not a single
    // run's figure. Computed on read (no FK denorm); the list is small, so a
    // few IN-queries + JS grouping is cheap.
    const prIds = rows.map((r) => r.id);
    const scoreByPr = new Map<string, number>();
    // One review id per (PR, agent) - that agent's own latest run - not one
    // per PR overall, so a PR reviewed by N agents contributes N reviews'
    // worth of findings, not just whichever agent happened to run last.
    const latestReviewIdsByPr = new Map<string, string[]>();
    if (prIds.length > 0) {
      const reviewRows = await container.db
        .select({ prId: t.reviews.prId, id: t.reviews.id, agentId: t.reviews.agentId, score: t.reviews.score })
        .from(t.reviews)
        .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
        .orderBy(desc(t.reviews.createdAt));
      // Rows are newest-first → first seen per (PR, agent) is that agent's
      // own latest review (for both the score and the findings preview).
      const latestByPrAgent = new Map<string, { reviewId: string; score: number | null }>();
      for (const rv of reviewRows) {
        const agentKey = `${rv.prId}:${rv.agentId ?? 'unknown'}`;
        if (!latestByPrAgent.has(agentKey)) latestByPrAgent.set(agentKey, { reviewId: rv.id, score: rv.score });
      }
      const scoresByPr = new Map<string, number[]>();
      for (const [key, { reviewId, score }] of latestByPrAgent) {
        const prId = key.slice(0, key.lastIndexOf(':'));
        (latestReviewIdsByPr.get(prId) ?? latestReviewIdsByPr.set(prId, []).get(prId)!).push(reviewId);
        if (score != null) (scoresByPr.get(prId) ?? scoresByPr.set(prId, []).get(prId)!).push(score);
      }
      for (const [prId, scores] of scoresByPr) {
        scoreByPr.set(prId, Math.round(scores.reduce((a, b) => a + b, 0) / scores.length));
      }
    }

    const costByPr = new Map<string, number>();
    if (prIds.length > 0) {
      const runRows = await container.db
        .select({ prId: t.agentRuns.prId, costUsd: t.agentRuns.costUsd })
        .from(t.agentRuns)
        .where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.status, 'done')));
      for (const rr of runRows) {
        if (rr.prId == null || rr.costUsd == null) continue;
        costByPr.set(rr.prId, (costByPr.get(rr.prId) ?? 0) + rr.costUsd);
      }
    }

    // FINDINGS column preview: findings from each agent's latest review,
    // summed across agents, grouped by severity for the count pills + a
    // lightweight read-only list for the hover popover (no rationale/
    // suggestion — that's the PR detail page).
    const findingsByPr = new Map<
      string,
      { severity_counts: Record<Severity, number>; items: FindingPreview[] }
    >();
    const latestReviewIds = [...latestReviewIdsByPr.values()].flat();
    if (latestReviewIds.length > 0) {
      const reviewIdToPrId = new Map(
        [...latestReviewIdsByPr].flatMap(([prId, reviewIds]) => reviewIds.map((id) => [id, prId] as const)),
      );
      const findingRows = await container.db
        .select({
          reviewId: t.findings.reviewId,
          severity: t.findings.severity,
          title: t.findings.title,
          category: t.findings.category,
          file: t.findings.file,
          startLine: t.findings.startLine,
          confidence: t.findings.confidence,
        })
        .from(t.findings)
        .where(inArray(t.findings.reviewId, latestReviewIds));
      for (const f of findingRows) {
        const prId = reviewIdToPrId.get(f.reviewId);
        if (!prId) continue;
        const entry = findingsByPr.get(prId) ?? {
          severity_counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
          items: [],
        };
        const sev = f.severity as Severity;
        if (sev in entry.severity_counts) entry.severity_counts[sev]++;
        entry.items.push({
          severity: sev,
          title: f.title,
          category: f.category,
          file: f.file,
          start_line: f.startLine,
          confidence: f.confidence,
        });
        findingsByPr.set(prId, entry);
      }
    }

    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      author: r.author,
      branch: r.branch,
      base: r.base,
      head_sha: r.headSha,
      additions: r.additions,
      deletions: r.deletions,
      files_count: r.filesCount,
      status: deriveReviewStatus({
        ghStatus: r.status,
        lastReviewedSha: r.lastReviewedSha,
        headSha: r.headSha,
        updatedAt: r.updatedAt,
        now,
      }),
      opened_at: r.openedAt?.toISOString() ?? null,
      updated_at: r.updatedAt?.toISOString() ?? null,
      score: scoreByPr.get(r.id) ?? null,
      cost_usd: costByPr.get(r.id) ?? null,
      findings: findingsByPr.get(r.id) ?? null,
    }));
  }

  async getPullDetail(workspaceId: string, id: string, logger?: Logger): Promise<PrDetail> {
    const { container } = this;
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id)));
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');

    // Local-first: refresh detail from GitHub when a token is configured;
    // otherwise serve the persisted files/commits/body (seeded or previously
    // imported) so PR detail works offline.
    try {
      const gh = await container.github();
      const detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pr.number);

      await container.db.delete(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      if (detail.files.length > 0) {
        await container.db.insert(t.prFiles).values(
          detail.files.map((f) => ({
            prId: pr.id,
            path: f.path,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch ?? null,
          })),
        );
      }
      await container.db.delete(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      if (detail.commits.length > 0) {
        await container.db.insert(t.prCommits).values(
          detail.commits.map((c) => ({
            prId: pr.id,
            sha: c.sha,
            message: c.message,
            author: c.author,
            committedAt: c.committed_at ? new Date(c.committed_at) : null,
          })),
        );
      }
      await container.db
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          // Diff stats aren't on GitHub's PR-list payload — backfill them from
          // the detail fetch so the Pull Requests list shows real size/files.
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, pr.id));

      return { ...detail, id: pr.id };
    } catch (err) {
      logger?.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
      const files = await container.db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));
      const commits = await container.db.select().from(t.prCommits).where(eq(t.prCommits.prId, pr.id));
      return {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        branch: pr.branch,
        base: pr.base,
        head_sha: pr.headSha,
        additions: pr.additions,
        deletions: pr.deletions,
        files_count: pr.filesCount,
        status: pr.status as PrDetail['status'],
        opened_at: pr.openedAt?.toISOString() ?? null,
        updated_at: pr.updatedAt?.toISOString() ?? null,
        body: pr.body ?? null,
        files: files.map((f) => ({
          path: f.path,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch ?? null,
        })),
        commits: commits.map((c) => ({
          sha: c.sha,
          message: c.message,
          author: c.author,
          committed_at: c.committedAt?.toISOString() ?? null,
        })),
      };
    }
  }

  // ---- Inline review comments (Files changed tab) -------------------------
  // Proxied live to GitHub (no local persistence): GET reflects existing PR
  // comments; POST creates one immediately. Keeps the tab in lock-step with
  // GitHub and avoids a stale local mirror.
  private async resolvePrAndRepo(id: string, workspaceId: string) {
    const { container } = this;
    const [pr] = await container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, id)));
    if (!pr) throw new NotFoundError('Pull request not found');
    const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  async listReviewComments(
    workspaceId: string,
    id: string,
    logger?: Logger,
  ): Promise<PrReviewComment[]> {
    const { container } = this;
    const { pr, repo } = await this.resolvePrAndRepo(id, workspaceId);
    let gh: GitHubClient;
    try {
      gh = await container.github();
    } catch (err) {
      logger?.warn({ err }, 'GitHub client unavailable; serving no PR comments');
      return [];
    }
    try {
      return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pr.number);
    } catch (err) {
      logger?.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  async createReviewComment(
    workspaceId: string,
    id: string,
    input: PrCommentInputType,
  ): Promise<PrReviewComment> {
    const { container } = this;
    const { pr, repo } = await this.resolvePrAndRepo(id, workspaceId);
    let gh: GitHubClient;
    try {
      gh = await container.github();
    } catch {
      throw new AppError('github_unavailable', 'Connect a GitHub token to post comments.', 400);
    }
    try {
      return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pr.number, {
        commitId: pr.headSha,
        path: input.path,
        line: input.line,
        ...(input.side ? { side: input.side } : {}),
        body: input.body,
        ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
      });
    } catch (err) {
      // GitHub rejects comments on lines outside the diff / on closed PRs (422).
      const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
      throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
    }
  }
}
