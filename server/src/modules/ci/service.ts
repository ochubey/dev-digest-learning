import {
  CI_TRIGGERS,
  type CiAgentView,
  type CiExport,
  type CiExportInput,
  type CiFile,
  type CiPreview,
  type CiRunsList,
  type CiSecretStatus,
  type CiSyncResult,
  type CiTrigger,
  type GitHubClient,
} from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { buildBundle, readRunner, toPreviewFiles } from './bundle.js';
import {
  AGENT_CI_RUNS,
  CI_BRANCH,
  CI_RUNNER_VERSION,
  CI_RUNS_PAGE,
  CI_WORKFLOW_PATH,
  CI_WORKFLOW_VERSION,
  COMMIT_MESSAGE,
} from './constants.js';
import { mapWriteError } from './github-errors.js';
import { exportLine } from './log-lines.js';
import { toCiInstallation, toCiRun } from './mappers.js';
import { buildPrBody, buildPrTitle } from './pr-body.js';
import type { CiActionsSource } from './ports.js';
import type { CiRepository, InstallationRow, RepoRow } from './repository.js';
import { toSlug, uniqueSlugs } from './slug.js';
import { syncWorkspace, type CiLogger } from './sync.js';
import { checkWorkflow } from './workflow-safety.js';
import { buildZip } from './zip.js';
import type { AgentRow } from '../../db/rows.js';

export interface CiDeps {
  repo: CiRepository;
  github: () => Promise<GitHubClient>;
  actions: () => Promise<CiActionsSource>;
  runnerPath: string;
  readFile: (path: string) => Promise<string>;
  log: CiLogger;
}

interface Prepared {
  agent: AgentRow;
  repoRow: RepoRow;
  slug: string;
  triggers: CiTrigger[];
  files: CiFile[];
}

function validateTriggers(input: string[]): CiTrigger[] {
  const unique = [...new Set(input)];
  const valid = CI_TRIGGERS.filter((t) => unique.includes(t));
  if (unique.length === 0 || valid.length !== unique.length) {
    throw new AppError(
      'ci_triggers_invalid',
      `Pick at least one of: ${CI_TRIGGERS.join(', ')}.`,
      400,
    );
  }
  return valid;
}

/**
 * Export-to-CI service. Onion: routes -> service -> repository / ports. Every check runs
 * before any write; the installation is only written after the export itself succeeded.
 */
export class CiService {
  constructor(private deps: CiDeps) {}

  async preview(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiPreview> {
    const p = await this.prepare(workspaceId, agentId, input);
    return {
      files: toPreviewFiles(p.files),
      slug: p.slug,
      workflow_version: CI_WORKFLOW_VERSION,
      runner_version: CI_RUNNER_VERSION,
    };
  }

  async export(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    try {
      const out = await this.doExport(workspaceId, agentId, input);
      this.deps.log.info(exportLine({ agentId, repo: input.repo, mode: input.action, outcome: 'ok' }));
      return out;
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'internal_error';
      this.deps.log.info(exportLine({ agentId, repo: input.repo, mode: input.action, outcome: 'error', code }));
      throw err;
    }
  }

  async agentView(workspaceId: string, agentId: string): Promise<CiAgentView> {
    const { repo } = this.deps;
    const agent = await repo.findAgent(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Not found');
    const installs = await repo.installationsForAgent(workspaceId, agentId);
    const last = await repo.lastRunPerInstallation(installs.map((i) => i.id));
    const lastBy = new Map(last.map((r) => [r.ciInstallationId, r]));
    const runs = await repo.listAgentRuns(workspaceId, agentId, AGENT_CI_RUNS);
    return {
      installations: installs.map((i) =>
        toCiInstallation(i, {
          configChanged: i.agentVersion !== agent.version || i.ciFailOn !== agent.ciFailOn,
          lastRun: lastBy.get(i.id) ?? null,
        }),
      ),
      runs: runs.map(toCiRun),
    };
  }

  async listRuns(workspaceId: string): Promise<CiRunsList> {
    const { repo } = this.deps;
    const [runs, count] = await Promise.all([
      repo.listRuns(workspaceId, CI_RUNS_PAGE),
      repo.countInstallations(workspaceId),
    ]);
    return { runs: runs.map(toCiRun), installations_count: count };
  }

  /** Whether the runner's OpenRouter secret exists on the repo (value never read). */
  async secretStatus(workspaceId: string, repoId: string): Promise<CiSecretStatus> {
    const repoRow = await this.deps.repo.findRepoById(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repository not found');
    const actions = await this.deps.actions();
    const state = await actions.secretExists(repoRow.fullName, 'OPENROUTER_API_KEY').catch(() => 'unknown' as const);
    return { OPENROUTER_API_KEY: state };
  }

  async sync(workspaceId: string): Promise<CiSyncResult> {
    const actions = await this.deps.actions();
    return syncWorkspace({ repo: this.deps.repo, actions, log: this.deps.log }, workspaceId);
  }

  // ---- internals -----------------------------------------------------------

  private async prepare(workspaceId: string, agentId: string, input: CiExportInput): Promise<Prepared> {
    const { repo } = this.deps;
    const agent = await repo.findAgent(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Not found');
    if (agent.provider !== 'openrouter') {
      throw new AppError('ci_provider_unsupported', 'CI export supports OpenRouter agents only', 400);
    }
    if (input.target !== 'gha') {
      throw new AppError('ci_provider_unsupported', 'Only GitHub Actions is supported', 400);
    }
    const repoRow = await repo.findRepoByFullName(workspaceId, input.repo);
    if (!repoRow) {
      throw new AppError('ci_repo_not_connected', `${input.repo} is not connected to this workspace`, 404);
    }
    const triggers = validateTriggers(input.triggers);
    const slug = toSlug(agent.name, 'agent');

    const existing = await repo.installationByRepo(workspaceId, repoRow.fullName);
    if (existing && existing.agentId !== agent.id) {
      throw new AppError(
        'ci_repo_taken',
        `${repoRow.fullName} already runs agent ${existing.agentName} in CI; one agent per repository is supported`,
        409,
      );
    }
    if (existing?.slug && existing.slug !== slug) {
      throw new AppError(
        'ci_slug_changed',
        `The agent name changed since the last export (${existing.slug} -> ${slug}). Rename it back, or remove the old files from ${repoRow.fullName} yourself.`,
        409,
      );
    }

    const [skills, memory] = await Promise.all([
      repo.enabledLinkedSkills(agent.id),
      repo.repoMemory(workspaceId, repoRow.id),
    ]);
    const runner = await readRunner(this.deps.runnerPath, this.deps.readFile);
    const skillSlugs = uniqueSlugs(skills.map((s) => s.name));
    const files = buildBundle({
      agent,
      agentSlug: slug,
      skills: skills.map((s, i) => ({ slug: skillSlugs[i]!, body: s.body })),
      memory,
      runner,
      triggers,
      postAs: input.post_as,
    });

    if (input.workflow != null) {
      const check = checkWorkflow(input.workflow);
      if (!check.ok) {
        throw new AppError('ci_workflow_unsafe', check.message, 400, { rule: check.rule });
      }
      // AC-30: the user's exact text replaces the generated workflow.
      const wf = files.find((f) => f.path === CI_WORKFLOW_PATH);
      if (wf) wf.contents = input.workflow;
    }
    return { agent, repoRow, slug, triggers, files };
  }

  private async doExport(workspaceId: string, agentId: string, input: CiExportInput): Promise<CiExport> {
    const p = await this.prepare(workspaceId, agentId, input);
    const { agent, repoRow, files } = p;

    if (input.action === 'files') {
      const zip = buildZip(files);
      const installation = await this.saveInstallation(p, input, null, null);
      return {
        installation: toCiInstallation(installation),
        files: toPreviewFiles(files),
        pr_url: null,
        zip_base64: zip.toString('base64'),
        zip_filename: `devdigest-ci-${repoRow.name}.zip`,
      };
    }

    const ref = { owner: repoRow.owner, name: repoRow.name };
    let prUrl: string;
    try {
      const github = await this.deps.github();
      await github.commitFiles(ref, {
        branch: CI_BRANCH,
        base: repoRow.defaultBranch,
        message: COMMIT_MESSAGE,
        files: files.map((f) => ({ path: f.path, contents: f.contents })),
      });
      const open = await github.findOpenPr(ref, CI_BRANCH);
      prUrl =
        open?.url ??
        (
          await github.openPullRequest(ref, {
            head: CI_BRANCH,
            base: repoRow.defaultBranch,
            title: buildPrTitle(agent.name),
            body: buildPrBody(files),
          })
        ).url;
    } catch (err) {
      throw err instanceof AppError ? err : mapWriteError(err, repoRow.fullName);
    }
    // Best effort: the first sync fills it in otherwise.
    const githubRepoId = await this.deps
      .actions()
      .then((a) => a.getRepoId(repoRow.fullName))
      .catch(() => null);
    const installation = await this.saveInstallation(p, input, prUrl, githubRepoId);
    return { installation: toCiInstallation(installation), files: toPreviewFiles(files), pr_url: prUrl };
  }

  private async saveInstallation(
    p: Prepared,
    input: CiExportInput,
    prUrl: string | null,
    githubRepoId: number | null,
  ): Promise<InstallationRow> {
    const row = await this.deps.repo.upsertInstallation({
      agentId: p.agent.id,
      repo: p.repoRow.fullName,
      targetType: 'gha',
      repoId: p.repoRow.id,
      githubRepoId,
      slug: p.slug,
      workflowVersion: CI_WORKFLOW_VERSION,
      agentVersion: p.agent.version,
      ciFailOn: p.agent.ciFailOn,
      postAs: input.post_as,
      triggers: p.triggers,
      files: p.files.map((f) => f.path),
      prUrl,
    });
    if (!row) {
      // Lost a race with another agent's export of the same repository.
      throw new AppError('ci_repo_taken', `${p.repoRow.fullName} already runs another agent in CI; one agent per repository is supported`, 409);
    }
    return row;
  }
}
