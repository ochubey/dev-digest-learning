import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { UnifiedDiff } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import { PullsService } from '../pulls/service.js';
import { loadDiff } from '../reviews/diff-loader.js';
import type { PullRow } from '../reviews/repository.js';

/**
 * Result of resolving the PR diff. A `loaded` diff may have zero files (every file deleted,
 * pure-rename, binary or patch-less); `unavailable` means no usable diff could be established.
 * `reason` is a fixed code, never error text.
 */
export type DiffLoadResult =
  | { status: 'loaded'; diff: UnifiedDiff }
  | { status: 'unavailable'; reason: string };

async function resolveChangedDiff(
  container: Container,
  workspaceId: string,
  pr: PullRow,
  log: FastifyBaseLogger,
): Promise<DiffLoadResult> {
  const [repo] = await container.db.select().from(t.repos).where(eq(t.repos.id, pr.repoId));
  if (!repo) return { status: 'unavailable', reason: 'repo_not_found' };
  const load = () => loadDiff(container, container.reviewRepo, workspaceId, pr, repo);

  // (1) the diff as it is now.
  try {
    const diff = await load();
    if (diff.files.length > 0) return { status: 'loaded', diff };
  } catch (err) {
    log.warn({ prId: pr.id, err: (err as Error).message, step: 'blast' }, 'blast: diff load failed');
  }

  // (2) import the PR detail once (persists pr_files), then read the diff again.
  try {
    await new PullsService(container).getPullDetail(workspaceId, pr.id, log);
    const diff = await load();
    if (diff.files.length > 0) return { status: 'loaded', diff };
    // (3) getPullDetail hides GitHub failures and serves persisted rows, so persisted rows
    // are the only evidence the PR really has files: all excluded from the diff -> 0 files.
    const rows = await container.reviewRepo.getPrFiles(pr.id);
    if (rows.length > 0) return { status: 'loaded', diff };
    // (4) nothing persisted after the import.
    return { status: 'unavailable', reason: 'no_pr_files' };
  } catch (err) {
    log.warn({ prId: pr.id, err: (err as Error).message, step: 'blast' }, 'blast: PR files import failed');
    return { status: 'unavailable', reason: 'diff_load_failed' };
  }
}

/** One resolution per PR at a time: the page fires /blast and /history together. */
const inFlight = new Map<string, Promise<DiffLoadResult>>();

/**
 * The diff of a PR, from the same source the review run loads (a real `git diff`, else the
 * persisted pr_files patches).
 *
 * A PR nobody has opened yet has no persisted files and its head commit is usually not in
 * the clone (forks), so the diff is empty and the map would wrongly read "no usable index".
 * In that case the PR detail is imported once (the same import the PR page does, which
 * persists pr_files) and the diff is read again. Concurrent callers for the same PR share
 * one resolution, so that import (a delete + insert of pr_files) never runs twice at once.
 *
 * Classification: files on the first read -> loaded; files after the import -> loaded; still
 * none but the PR has pr_files rows -> loaded with 0 files; no rows, no repo or any failure ->
 * unavailable. Fail-open: never throws.
 */
export function changedDiffForPr(
  container: Container,
  workspaceId: string,
  pr: PullRow,
  log: FastifyBaseLogger,
): Promise<DiffLoadResult> {
  const running = inFlight.get(pr.id);
  if (running) return running;
  const started = resolveChangedDiff(container, workspaceId, pr, log)
    .catch((err): DiffLoadResult => {
      log.warn({ prId: pr.id, err: (err as Error).message, step: 'blast' }, 'blast: diff resolution failed');
      return { status: 'unavailable', reason: 'diff_load_failed' };
    })
    .finally(() => {
      inFlight.delete(pr.id);
    });
  inFlight.set(pr.id, started);
  return started;
}

/**
 * Paths of the files a PR changes (see `changedDiffForPr`). Fail-open: any failure yields
 * `[]`, so the blast lookup degrades to `no_data` instead of erroring.
 */
export async function changedFilesForPr(
  container: Container,
  workspaceId: string,
  pr: PullRow,
  log: FastifyBaseLogger,
): Promise<string[]> {
  const r = await changedDiffForPr(container, workspaceId, pr, log);
  return r.status === 'loaded' ? r.diff.files.map((f) => f.path) : [];
}
