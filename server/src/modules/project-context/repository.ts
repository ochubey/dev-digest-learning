import { eq, desc } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { AgentsRepository } from '../agents/repository.js';
import { SkillsRepository } from '../skills/repository.js';

export interface RepoInfo {
  id: string;
  workspaceId: string;
  owner: string;
  name: string;
  defaultBranch: string;
}
export interface AgentInfo {
  id: string;
  workspaceId: string;
  contextPaths: string[];
  version: number;
}
export interface SkillInfo {
  id: string;
  workspaceId: string;
  contextPaths: string[];
  version: number;
}
export interface LinkedSkillInfo {
  id: string;
  name: string;
  enabled: boolean;
  contextPaths: string[];
}
export interface WorkspaceUsage {
  agents: { contextPaths: string[]; skillIds: string[] }[];
  skills: { id: string; enabled: boolean; contextPaths: string[] }[];
}
export interface SavedPaths {
  version: number;
  contextPaths: string[];
}

/** Data access the service depends on (the service tests substitute an in-memory one). */
export interface ProjectContextStore {
  /** Unscoped lookups: the service maps missing -> 404 and other workspace -> 403. */
  findRepo(id: string): Promise<RepoInfo | undefined>;
  findAgent(id: string): Promise<AgentInfo | undefined>;
  findSkill(id: string): Promise<SkillInfo | undefined>;
  /** The workspace repo with the latest `createdAt`, or null. */
  latestRepoId(workspaceId: string): Promise<string | null>;
  /** Every agent (with its linked skill ids) and skill in the workspace, for "used by" counts. */
  workspaceUsage(workspaceId: string): Promise<WorkspaceUsage>;
  /** The agent's linked skills in link order (enabled or not). */
  linkedSkillsWithPaths(agentId: string): Promise<LinkedSkillInfo[]>;
  /** Writes own versioning in the agents/skills repositories. */
  setAgentPaths(workspaceId: string, id: string, paths: string[]): Promise<SavedPaths | undefined>;
  setSkillPaths(workspaceId: string, id: string, paths: string[]): Promise<SavedPaths | undefined>;
}

export class ProjectContextRepository implements ProjectContextStore {
  private agents: AgentsRepository;
  private skills: SkillsRepository;

  constructor(private db: Db) {
    this.agents = new AgentsRepository(db);
    this.skills = new SkillsRepository(db);
  }

  async findRepo(id: string): Promise<RepoInfo | undefined> {
    const [r] = await this.db.select().from(t.repos).where(eq(t.repos.id, id));
    return r && {
      id: r.id,
      workspaceId: r.workspaceId,
      owner: r.owner,
      name: r.name,
      defaultBranch: r.defaultBranch,
    };
  }

  async findAgent(id: string): Promise<AgentInfo | undefined> {
    const [r] = await this.db.select().from(t.agents).where(eq(t.agents.id, id));
    return r && { id: r.id, workspaceId: r.workspaceId, contextPaths: r.contextPaths, version: r.version };
  }

  async findSkill(id: string): Promise<SkillInfo | undefined> {
    const [r] = await this.db.select().from(t.skills).where(eq(t.skills.id, id));
    return r && { id: r.id, workspaceId: r.workspaceId, contextPaths: r.contextPaths, version: r.version };
  }

  async latestRepoId(workspaceId: string): Promise<string | null> {
    const [r] = await this.db
      .select({ id: t.repos.id })
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId))
      .orderBy(desc(t.repos.createdAt))
      .limit(1);
    return r?.id ?? null;
  }

  async workspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
    const agentRows = await this.db
      .select({ id: t.agents.id, contextPaths: t.agents.contextPaths })
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));
    const skillRows = await this.db
      .select({ id: t.skills.id, enabled: t.skills.enabled, contextPaths: t.skills.contextPaths })
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId));
    const links = await this.db
      .select({ agentId: t.agentSkills.agentId, skillId: t.agentSkills.skillId })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId));
    const byAgent = new Map<string, string[]>();
    for (const l of links) byAgent.set(l.agentId, [...(byAgent.get(l.agentId) ?? []), l.skillId]);
    return {
      agents: agentRows.map((a) => ({ contextPaths: a.contextPaths, skillIds: byAgent.get(a.id) ?? [] })),
      skills: skillRows,
    };
  }

  async linkedSkillsWithPaths(agentId: string): Promise<LinkedSkillInfo[]> {
    const links = await this.agents.linkedSkills(agentId);
    return links.map((l) => ({
      id: l.skill.id,
      name: l.skill.name,
      enabled: l.skill.enabled,
      contextPaths: l.skill.contextPaths,
    }));
  }

  async setAgentPaths(workspaceId: string, id: string, paths: string[]): Promise<SavedPaths | undefined> {
    const row = await this.agents.setContextPaths(workspaceId, id, paths);
    return row && { version: row.version, contextPaths: row.contextPaths };
  }

  async setSkillPaths(workspaceId: string, id: string, paths: string[]): Promise<SavedPaths | undefined> {
    const row = await this.skills.setContextPaths(workspaceId, id, paths);
    return row && { version: row.version, contextPaths: row.contextPaths };
  }
}
