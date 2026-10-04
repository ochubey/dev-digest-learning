import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import { PullsService } from '../pulls/service.js';
import { loadDiff } from '../reviews/diff-loader.js';
import type { PullRow } from '../reviews/repository.js';

/** Paths of the PR diff: a real `git diff`, else the persisted pr_files patches. */
async function loadPaths(container: Container, workspaceId: string, pr: PullRow): Promise<string[]> {
  const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
  if (!repo) return [];
  const diff = await loadDiff(container, container.reviewRepo, workspaceId, pr, repo);
  return diff.files.map((f) => f.path);
}

/**
 * Paths of the files a PR changes, from the same diff the review run loads (a real
 * `git diff`, else the persisted pr_files patches).
 *
 * A PR nobody has opened yet has no persisted files and its head commit is usually not in
 * the clone (forks), so the diff is empty and the map would wrongly read "no usable index".
 * In that case the PR detail is imported once (the same import the PR page does, which
 * persists pr_files) and the diff is read again.
 *
 * Fail-open: any failure yields `[]`, so the blast lookup degrades to `no_data` instead of
 * erroring.
 */
export async function changedFilesForPr(
  container: Container,
  workspaceId: string,
  pr: PullRow,
  log: FastifyBaseLogger,
): Promise<string[]> {
  try {
    const files = await loadPaths(container, workspaceId, pr);
    if (files.length > 0) return files;
  } catch (err) {
    log.warn({ prId: pr.id, err: (err as Error).message, step: 'blast' }, 'blast: diff load failed');
  }

  try {
    await new PullsService(container).getPullDetail(workspaceId, pr.id, log);
    return await loadPaths(container, workspaceId, pr);
  } catch (err) {
    log.warn({ prId: pr.id, err: (err as Error).message, step: 'blast' }, 'blast: PR files import failed');
    return [];
  }
}
