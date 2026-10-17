import type { CiRepository, InstallationRow, RepoRow, RunRow, SkillRow, MemoryRow, SyncInstallation } from '../../src/modules/ci/repository.js';
import type { AgentRow } from '../../src/db/rows.js';
import type { AgentRunValues, CiRunValues } from '../../src/modules/ci/ingest.js';

export const WS = '11111111-1111-4111-8111-111111111111';
export const AGENT_ID = '44444444-4444-4444-8444-444444444444';
export const OTHER_AGENT_ID = '55555555-5555-4555-8555-555555555555';
export const REPO_ID = '33333333-3333-4333-8333-333333333333';
export const INST_ID = '77777777-7777-4777-8777-777777777777';

export const agentRow = (over: Partial<AgentRow> = {}): AgentRow =>
  ({
    id: AGENT_ID,
    workspaceId: WS,
    name: 'Secret Gate',
    description: '',
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
    systemPrompt: 'Review for secrets.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: true,
    enabled: true,
    contextPaths: [],
    version: 3,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }) as AgentRow;

export const repoRow = (over: Partial<RepoRow> = {}): RepoRow =>
  ({
    id: REPO_ID,
    workspaceId: WS,
    owner: 'acme',
    name: 'widgets',
    fullName: 'acme/widgets',
    defaultBranch: 'main',
    clonePath: null,
    lastPolledAt: null,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  }) as RepoRow;

export const installationRow = (over: Partial<InstallationRow> = {}): InstallationRow =>
  ({
    id: INST_ID,
    agentId: AGENT_ID,
    repo: 'acme/widgets',
    targetType: 'gha',
    installedAt: new Date('2026-02-01T00:00:00Z'),
    repoId: REPO_ID,
    githubRepoId: 999,
    slug: 'secret-gate',
    workflowVersion: 1,
    agentVersion: 3,
    ciFailOn: 'critical',
    postAs: 'github_review',
    triggers: ['opened', 'synchronize'],
    files: [],
    prUrl: null,
    workflowFile: null,
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    ...over,
  }) as InstallationRow;

export const skillRow = (name: string, body: string, id = name): SkillRow =>
  ({ id, name, body, enabled: true }) as unknown as SkillRow;

/** In-memory stand-in for CiRepository: records every write; `as unknown as CiRepository`. */
export class FakeCiRepo {
  agent: AgentRow | undefined = agentRow();
  repo: RepoRow | undefined = repoRow();
  skills: SkillRow[] = [];
  memory: (MemoryRow | { id: string; kind: string; scope: string; content: string; createdAt: Date })[] = [];
  /** Every installation on the repo (one per agent). */
  installations: (InstallationRow & { agentName: string })[] = [];
  /** Single-installation shorthand: reads the first, assigning replaces them all. */
  get installation(): (InstallationRow & { agentName: string }) | undefined {
    return this.installations[0];
  }
  set installation(v: (InstallationRow & { agentName: string }) | undefined) {
    this.installations = v ? [v] : [];
  }
  syncInstallations: SyncInstallation[] = [];
  upsertResult: InstallationRow | 'echo' = 'echo';
  knownRunIds = new Set<number>();
  importedPr: string | null = null;
  lastRuns: RunRow[] = [];
  runs: RunRow[] = [];
  count = 0;

  upserts: Record<string, unknown>[] = [];
  inserted: { row: CiRunValues; agentRun?: AgentRunValues }[] = [];
  githubRepoIdSets: { id: string; githubRepoId: number }[] = [];

  async findAgent() {
    return this.agent;
  }
  async findRepoById(_ws: string, id: string) {
    return this.repo && this.repo.id === id && this.repo.workspaceId === _ws ? this.repo : undefined;
  }
  async findRepoByFullName(_ws: string, fullName: string) {
    return this.repo && this.repo.fullName === fullName ? this.repo : undefined;
  }
  async enabledLinkedSkills() {
    return this.skills;
  }
  async repoMemory() {
    return this.memory;
  }
  async installationsByRepo() {
    return this.installations;
  }
  async upsertInstallation(values: Record<string, unknown>) {
    this.upserts.push(values);
    if (this.upsertResult === 'echo') {
      return installationRow({
        ...(values as Partial<InstallationRow>),
        triggers: values.triggers as string[],
        files: values.files as string[],
      });
    }
    return this.upsertResult;
  }
  async installationsForAgent() {
    return this.installations;
  }
  async installationsForSync() {
    return this.syncInstallations;
  }
  async setGithubRepoId(id: string, githubRepoId: number) {
    this.githubRepoIdSets.push({ id, githubRepoId });
  }
  async existingRunIds(ids: number[]) {
    return new Set(ids.filter((i) => this.knownRunIds.has(i)));
  }
  async findImportedPr() {
    return this.importedPr;
  }
  async insertRun(row: CiRunValues, agentRun?: AgentRunValues) {
    this.inserted.push({ row, agentRun });
    this.knownRunIds.add(row.githubRunId);
    return true;
  }
  async listRuns() {
    return this.runs;
  }
  async listAgentRuns() {
    return this.runs;
  }
  async lastRunPerInstallation() {
    return this.lastRuns;
  }
  async countInstallations() {
    return this.count;
  }
}

export const asRepo = (f: FakeCiRepo) => f as unknown as CiRepository;

export const syncInstallation = (over: Partial<SyncInstallation> = {}): SyncInstallation =>
  ({
    ...installationRow(),
    agentName: 'Secret Gate',
    workspaceId: WS,
    ...over,
  }) as SyncInstallation;
