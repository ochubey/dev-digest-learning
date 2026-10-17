import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { AgentRunValues, CiRunValues } from './ingest.js';

export type SkillRow = typeof t.skills.$inferSelect;
export type MemoryRow = typeof t.memory.$inferSelect;
export type RepoRow = typeof t.repos.$inferSelect;
export type InstallationRow = typeof t.ciInstallations.$inferSelect;
export type RunRow = typeof t.ciRuns.$inferSelect;

export type InstallationValues = Omit<typeof t.ciInstallations.$inferInsert, 'id' | 'installedAt'>;

export interface SyncInstallation extends InstallationRow {
  agentName: string;
  workspaceId: string;
}

/** ci data access. Workspace-scoped through the agent (installations) or the row's own workspace. */
export class CiRepository {
  constructor(private db: DbOrTx) {}

  async findAgent(workspaceId: string, agentId: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.id, agentId), eq(t.agents.workspaceId, workspaceId)));
    return row;
  }

  async findRepoByFullName(workspaceId: string, fullName: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, fullName)));
    return row;
  }

  async findRepoById(workspaceId: string, id: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)));
    return row;
  }

  /** Enabled linked skills; ties on `order` broken by skill id so the order is deterministic. */
  async enabledLinkedSkills(agentId: string): Promise<SkillRow[]> {
    const rows = await this.db
      .select({ skill: t.skills })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.skills.enabled, true)))
      .orderBy(asc(t.agentSkills.order), asc(t.skills.id));
    return rows.map((r) => r.skill);
  }

  async repoMemory(workspaceId: string, repoId: string): Promise<MemoryRow[]> {
    return this.db
      .select()
      .from(t.memory)
      .where(and(eq(t.memory.workspaceId, workspaceId), eq(t.memory.repoId, repoId)));
  }

  async installationByRepo(
    workspaceId: string,
    fullName: string,
  ): Promise<(InstallationRow & { agentName: string }) | undefined> {
    const [row] = await this.db
      .select({ inst: t.ciInstallations, agentName: t.agents.name })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.ciInstallations.repo, fullName), eq(t.agents.workspaceId, workspaceId)));
    return row ? { ...row.inst, agentName: row.agentName } : undefined;
  }

  /**
   * One installation per repository: insert, or update when the same agent owns it.
   * `null` means another agent owns the repository.
   */
  async upsertInstallation(values: InstallationValues): Promise<InstallationRow | null> {
    // An existing GitHub repository id is never overwritten by null.
    const { githubRepoId, ...rest } = values;
    const [row] = await this.db
      .insert(t.ciInstallations)
      .values(values)
      .onConflictDoUpdate({
        target: t.ciInstallations.repo,
        set: { ...rest, ...(githubRepoId != null ? { githubRepoId } : {}), updatedAt: new Date() },
        setWhere: eq(t.ciInstallations.agentId, values.agentId),
      })
      .returning();
    return row ?? null;
  }

  async installationsForAgent(workspaceId: string, agentId: string): Promise<InstallationRow[]> {
    const rows = await this.db
      .select({ inst: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.agents.workspaceId, workspaceId)))
      .orderBy(asc(t.ciInstallations.installedAt), asc(t.ciInstallations.id));
    return rows.map((r) => r.inst);
  }

  /** Installations of repositories still connected to the studio. */
  async installationsForSync(workspaceId: string): Promise<SyncInstallation[]> {
    const rows = await this.db
      .select({ inst: t.ciInstallations, agentName: t.agents.name, workspaceId: t.agents.workspaceId })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), isNotNull(t.ciInstallations.repoId)))
      .orderBy(asc(t.ciInstallations.repo));
    return rows.map((r) => ({ ...r.inst, agentName: r.agentName, workspaceId: r.workspaceId }));
  }

  async setGithubRepoId(installationId: string, githubRepoId: number): Promise<void> {
    await this.db.update(t.ciInstallations).set({ githubRepoId }).where(eq(t.ciInstallations.id, installationId));
  }

  async existingRunIds(githubRunIds: number[]): Promise<Set<number>> {
    if (githubRunIds.length === 0) return new Set();
    const rows = await this.db
      .select({ id: t.ciRuns.githubRunId })
      .from(t.ciRuns)
      .where(inArray(t.ciRuns.githubRunId, githubRunIds));
    return new Set(rows.map((r) => r.id).filter((id): id is number => id != null));
  }

  async findImportedPr(workspaceId: string, repoId: string, number: number): Promise<string | null> {
    const [row] = await this.db
      .select({ id: t.pullRequests.id })
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
          eq(t.pullRequests.number, number),
        ),
      );
    return row?.id ?? null;
  }

  /**
   * Stores a CI run once (unique `github_run_id`). When the row is new and an `agent_runs`
   * payload is given, both are written in ONE transaction and linked. Returns whether it inserted.
   */
  async insertRun(row: CiRunValues, agentRun?: AgentRunValues): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(t.ciRuns)
        .values(row)
        .onConflictDoNothing({ target: t.ciRuns.githubRunId })
        .returning({ id: t.ciRuns.id });
      if (!inserted) return false;
      if (agentRun) {
        const [run] = await tx.insert(t.agentRuns).values(agentRun).returning({ id: t.agentRuns.id });
        if (run) await tx.update(t.ciRuns).set({ agentRunId: run.id }).where(eq(t.ciRuns.id, inserted.id));
      }
      return true;
    });
  }

  async listRuns(workspaceId: string, limit: number): Promise<RunRow[]> {
    return this.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.workspaceId, workspaceId))
      .orderBy(sql`${t.ciRuns.ranAt} desc nulls last`, desc(t.ciRuns.id))
      .limit(limit);
  }

  async listAgentRuns(workspaceId: string, agentId: string, limit: number): Promise<RunRow[]> {
    return this.db
      .select()
      .from(t.ciRuns)
      .where(and(eq(t.ciRuns.workspaceId, workspaceId), eq(t.ciRuns.agentId, agentId)))
      .orderBy(sql`${t.ciRuns.ranAt} desc nulls last`, desc(t.ciRuns.id))
      .limit(limit);
  }

  /** The newest run of each installation. */
  async lastRunPerInstallation(installationIds: string[]): Promise<RunRow[]> {
    if (installationIds.length === 0) return [];
    return this.db
      .selectDistinctOn([t.ciRuns.ciInstallationId])
      .from(t.ciRuns)
      .where(inArray(t.ciRuns.ciInstallationId, installationIds))
      .orderBy(t.ciRuns.ciInstallationId, sql`${t.ciRuns.ranAt} desc nulls last`, desc(t.ciRuns.id));
  }

  async countInstallations(workspaceId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId));
    return row?.n ?? 0;
  }
}
