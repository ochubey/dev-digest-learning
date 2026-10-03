import { and, eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';

export interface PollResult {
  synced: number;
  reviewTriggered: false;
}

/**
 * F1 — polling service. MANUAL refresh that ONLY syncs the PR list
 * (new/updated PRs appear, head_sha updates). It does NOT trigger any review —
 * review is manual (user presses Run Review, owned by A2).
 */
export class PollingService {
  constructor(private container: Container) {}

  async pollRepo(workspaceId: string, repoId: string): Promise<PollResult> {
    const { container } = this;
    const [repo] = await container.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    if (!repo) throw new NotFoundError('Repo not found');

    const gh = await container.github();
    const pulls = await gh.listPullRequests({ owner: repo.owner, name: repo.name });
    let synced = 0;
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
      synced++;
    }
    await container.db
      .update(t.repos)
      .set({ lastPolledAt: new Date() })
      .where(eq(t.repos.id, repo.id));

    // NOTE: no review is triggered here — manual trigger only.
    return { synced, reviewTriggered: false };
  }
}
