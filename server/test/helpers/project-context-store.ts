import type {
  AgentInfo,
  ProjectContextStore,
  RepoInfo,
  SkillInfo,
  LinkedSkillInfo,
  WorkspaceUsage,
} from '../../src/modules/project-context/repository.js';

export const WS = '11111111-1111-4111-8111-111111111111';
export const OTHER_WS = '22222222-2222-4222-8222-222222222222';
export const REPO_ID = '33333333-3333-4333-8333-333333333333';
export const AGENT_ID = '44444444-4444-4444-8444-444444444444';
export const SKILL_ID = '55555555-5555-4555-8555-555555555555';
export const SKILL2_ID = '66666666-6666-4666-8666-666666666666';

/** In-memory ProjectContextStore: authorization/usage data driven by plain fixtures. */
export class FakeProjectContextStore implements ProjectContextStore {
  repos = new Map<string, RepoInfo>();
  agents = new Map<string, AgentInfo>();
  skills = new Map<string, SkillInfo & { name: string; enabled: boolean }>();
  /** agentId -> skill ids in link order */
  links = new Map<string, string[]>();
  writes: { kind: 'agent' | 'skill'; id: string; paths: string[] }[] = [];

  async findRepo(id: string) {
    return this.repos.get(id);
  }
  async findAgent(id: string) {
    return this.agents.get(id);
  }
  async findSkill(id: string) {
    return this.skills.get(id);
  }
  async latestRepoId(workspaceId: string) {
    const rows = [...this.repos.values()].filter((r) => r.workspaceId === workspaceId);
    return rows.at(-1)?.id ?? null;
  }
  async workspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
    return {
      agents: [...this.agents.values()]
        .filter((a) => a.workspaceId === workspaceId)
        .map((a) => ({ contextPaths: a.contextPaths, skillIds: this.links.get(a.id) ?? [] })),
      skills: [...this.skills.values()]
        .filter((s) => s.workspaceId === workspaceId)
        .map((s) => ({ id: s.id, enabled: s.enabled, contextPaths: s.contextPaths })),
    };
  }
  async linkedSkillsWithPaths(agentId: string): Promise<LinkedSkillInfo[]> {
    return (this.links.get(agentId) ?? []).map((id) => {
      const s = this.skills.get(id)!;
      return { id, name: s.name, enabled: s.enabled, contextPaths: s.contextPaths };
    });
  }
  async setAgentPaths(_ws: string, id: string, paths: string[]) {
    const a = this.agents.get(id);
    if (!a) return undefined;
    this.writes.push({ kind: 'agent', id, paths });
    if (JSON.stringify(a.contextPaths) !== JSON.stringify(paths)) a.version += 1;
    a.contextPaths = paths;
    return { version: a.version, contextPaths: a.contextPaths };
  }
  async setSkillPaths(_ws: string, id: string, paths: string[]) {
    const s = this.skills.get(id);
    if (!s) return undefined;
    this.writes.push({ kind: 'skill', id, paths });
    if (JSON.stringify(s.contextPaths) !== JSON.stringify(paths)) s.version += 1;
    s.contextPaths = paths;
    return { version: s.version, contextPaths: s.contextPaths };
  }
}

export function seedStore(over: { repoWs?: string; agentWs?: string; skillWs?: string } = {}) {
  const store = new FakeProjectContextStore();
  store.repos.set(REPO_ID, {
    id: REPO_ID,
    workspaceId: over.repoWs ?? WS,
    owner: 'acme',
    name: 'payments-api',
    defaultBranch: 'main',
  });
  store.agents.set(AGENT_ID, {
    id: AGENT_ID,
    workspaceId: over.agentWs ?? WS,
    contextPaths: ['docs/own.md'],
    version: 1,
  });
  store.skills.set(SKILL_ID, {
    id: SKILL_ID,
    workspaceId: over.skillWs ?? WS,
    contextPaths: ['specs/skill.md'],
    version: 1,
    name: 'Security',
    enabled: true,
  });
  store.skills.set(SKILL2_ID, {
    id: SKILL2_ID,
    workspaceId: WS,
    contextPaths: ['insights/off.md'],
    version: 1,
    name: 'Disabled skill',
    enabled: false,
  });
  store.links.set(AGENT_ID, [SKILL_ID, SKILL2_ID]);
  return store;
}
