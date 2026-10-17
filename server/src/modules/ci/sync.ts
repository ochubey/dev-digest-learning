import type { CiSyncResult } from '@devdigest/shared';
import { withTimeout } from '../../platform/resilience.js';
import {
  MAX_ARCHIVE_BYTES,
  MAX_RUNS_PER_SYNC,
  SYNC_INSTALL_TIMEOUT_MS,
  WORKFLOW_FILE,
} from './constants.js';
import { mapReadError } from './github-errors.js';
import {
  NO_ARTIFACT_REASON,
  agentRunValues,
  failedRunRow,
  rejectedReason,
  validRunRow,
  validateArtifact,
  type IngestInstallation,
} from './ingest.js';
import { rejectLine, syncLine } from './log-lines.js';
import { ArtifactTooLargeError, type CiActionsSource } from './ports.js';
import type { CiRepository, SyncInstallation } from './repository.js';
import { readResultArchive } from './zip.js';

export interface CiLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface SyncDeps {
  repo: CiRepository;
  actions: CiActionsSource;
  log: CiLogger;
  /** Per-installation time budget; overridable for tests. */
  timeoutMs?: number;
}

interface InstallationOutcome {
  seen: number;
  ingested: number;
  rejected: number;
}

async function syncInstallation(deps: SyncDeps, inst: SyncInstallation): Promise<InstallationOutcome & { rules: string[] }> {
  const { repo, actions, log } = deps;
  let githubRepoId = inst.githubRepoId;
  if (githubRepoId == null) {
    githubRepoId = await actions.getRepoId(inst.repo);
    await repo.setGithubRepoId(inst.id, githubRepoId);
  }
  const runs = await actions.listCompletedRuns(inst.repo, inst.workflowFile ?? WORKFLOW_FILE, MAX_RUNS_PER_SYNC);
  const known = await repo.existingRunIds(runs.map((r) => r.id));
  const fresh = runs.filter((r) => !known.has(r.id));

  const ingest: IngestInstallation = {
    id: inst.id,
    agentId: inst.agentId,
    workspaceId: inst.workspaceId,
    agentName: inst.agentName,
    repo: inst.repo,
    githubRepoId,
    workflowVersion: inst.workflowVersion,
  };
  const out = { seen: runs.length, ingested: 0, rejected: 0, rules: [] as string[] };

  const reject = async (run: (typeof fresh)[number], rule: string) => {
    out.rejected++;
    out.rules.push(rule);
    log.warn(rejectLine({ installationId: inst.id, runId: run.id, rule }));
    await repo.insertRun(failedRunRow(run, ingest, rejectedReason(rule)));
  };

  for (const run of fresh) {
    let bytes: Uint8Array | null;
    try {
      bytes = await actions.downloadResultArtifact(inst.repo, run.id, MAX_ARCHIVE_BYTES);
    } catch (err) {
      if (err instanceof ArtifactTooLargeError) {
        await reject(run, 'archive_too_large');
        continue;
      }
      throw err;
    }
    if (!bytes) {
      await repo.insertRun(failedRunRow(run, ingest, NO_ARTIFACT_REASON));
      continue;
    }
    const archive = readResultArchive(bytes);
    if (!archive.ok) {
      await reject(run, archive.rule);
      continue;
    }
    const checked = validateArtifact(archive.json, run, ingest);
    if (!checked.ok) {
      await reject(run, checked.rule);
      continue;
    }
    const row = validRunRow(run, ingest, checked.artifact);
    const prId =
      row.prNumber != null && inst.repoId
        ? await repo.findImportedPr(inst.workspaceId, inst.repoId, row.prNumber)
        : null;
    if (await repo.insertRun(row, agentRunValues(row, checked.artifact, prId))) out.ingested++;
  }
  return out;
}

/** Pulls and ingests new runs for every installation of the workspace; one failure does not stop the others (AC-68). */
export async function syncWorkspace(deps: SyncDeps, workspaceId: string): Promise<CiSyncResult> {
  const installations = await deps.repo.installationsForSync(workspaceId);
  const settled = await Promise.allSettled(
    installations.map((inst) =>
      withTimeout(syncInstallation(deps, inst), deps.timeoutMs ?? SYNC_INSTALL_TIMEOUT_MS),
    ),
  );
  const result: CiSyncResult = {
    synced_at: new Date().toISOString(),
    seen: 0,
    ingested: 0,
    rejected: 0,
    failures: [],
  };
  settled.forEach((s, i) => {
    const inst = installations[i]!;
    if (s.status === 'fulfilled') {
      result.seen += s.value.seen;
      result.ingested += s.value.ingested;
      result.rejected += s.value.rejected;
      deps.log.info(syncLine({ repo: inst.repo, installationId: inst.id, ...s.value }));
    } else {
      const failure = mapReadError(s.reason, inst.repo);
      result.failures.push({ repo: inst.repo, ...failure });
      deps.log.info(
        syncLine({ repo: inst.repo, installationId: inst.id, seen: 0, ingested: 0, rejected: 0, rules: [], code: failure.code }),
      );
    }
  });
  return result;
}
