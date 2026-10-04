import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import { loadDiff } from '../reviews/diff-loader.js';
import type { PullRow } from '../reviews/repository.js';

/**
 * Paths of the files a PR changes, from the same diff the review run loads (a real
 * `git diff`, else the persisted pr_files patches). Fail-open: any failure yields `[]`,
 * so the blast lookup degrades to `no_data` instead of erroring.
 */
export async function changedFilesForPr(
  container: Container,
  workspaceId: string,
  pr: PullRow,
  log: FastifyBaseLogger,
): Promise<string[]> {
  try {
    const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
    if (!repo) return [];
    const diff = await loadDiff(container, container.reviewRepo, workspaceId, pr, repo);
    return diff.files.map((f) => f.path);
  } catch (err) {
    log.warn({ prId: pr.id, err: (err as Error).message, step: 'blast' }, 'blast: diff load failed');
    return [];
  }
}
