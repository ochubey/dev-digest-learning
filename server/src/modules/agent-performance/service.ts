import type { AgentStats } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { COST_BASIS } from './constants.js';
import type { Period } from './period.js';
import { AgentPerformanceRepository } from './repository.js';
import {
  buildAgentStats, buildTotals, costByAgent, costByModel, mostActive,
  type ModelAggRow,
} from './rules.js';
import type { AgentPerformance } from './schemas.js';

interface Aggregate {
  agents: AgentStats[];
  models: ModelAggRow[];
}

/**
 * Read-only aggregation behind both endpoints. `aggregate` is the single place that
 * turns stored runs and findings into `AgentStats`; the per-agent endpoint and the
 * dashboard both go through it, so their entries for the same period are equal by
 * construction (SPEC-06 AC-20). Only the repository (SELECTs) and the agents list are used:
 * nothing that calls a model or starts a review.
 */
export class AgentPerformanceService {
  constructor(private container: Container) {}

  /**
   * The aggregate queries run on separate statements; at READ COMMITTED a run or finding
   * written between them would make the totals disagree with the per-agent rows. One
   * read-only REPEATABLE READ transaction gives all of them the same snapshot, and
   * `read only` makes the database refuse any write from this module.
   */
  private snapshot<T>(fn: (repo: AgentPerformanceRepository) => Promise<T>): Promise<T> {
    return this.container.db.transaction((tx) => fn(new AgentPerformanceRepository(tx)), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    });
  }

  /** `AgentStats` of one agent; 404 when it is not in the workspace. */
  async agentStats(workspaceId: string, agentId: string, period: Period): Promise<AgentStats> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const { agents } = await this.snapshot((repo) => this.aggregate(repo, workspaceId, period, [{ id: agent.id, name: agent.name }]));
    return agents[0]!;
  }

  /** Workspace-wide dashboard: one entry per agent of the workspace, including agents with no runs. */
  async dashboard(workspaceId: string, period: Period): Promise<AgentPerformance> {
    const rows = await this.container.agentsRepo.list(workspaceId);
    const [{ agents, models }, deleted] = await this.snapshot((repo) =>
      Promise.all([
        this.aggregate(repo, workspaceId, period, rows.map((a) => ({ id: a.id, name: a.name }))),
        repo.deletedAgentRuns(workspaceId, period),
      ]),
    );
    return {
      period: { from: period.from.toISOString(), to: period.to.toISOString() },
      cost_basis: COST_BASIS,
      totals: buildTotals(agents, deleted),
      most_active: mostActive(agents),
      agents,
      cost_by_agent: costByAgent(agents),
      cost_by_model: costByModel(models),
    };
  }

  private async aggregate(
    repo: AgentPerformanceRepository,
    workspaceId: string,
    period: Period,
    list: { id: string; name: string }[],
  ): Promise<Aggregate> {
    if (list.length === 0) return { agents: [], models: [] };
    const ids = list.map((a) => a.id);
    // A fixed number of grouped queries, whatever the number of agents.
    const [runs, findings, days, allTime, models] = await Promise.all([
      repo.runAggregates(workspaceId, period, ids),
      repo.findingAggregates(workspaceId, period, ids),
      repo.dayCounts(workspaceId, period, ids),
      repo.lastDoneAllTime(workspaceId, ids),
      repo.modelAggregates(workspaceId, period, ids),
    ]);
    const runByAgent = new Map(runs.map((r) => [r.agentId, r]));
    const agents = list.map((agent) =>
      buildAgentStats({
        agent,
        period,
        run: runByAgent.get(agent.id),
        findings: findings.filter((f) => f.agentId === agent.id),
        days: days.get(agent.id) ?? [],
        lastRunAllTime: allTime.get(agent.id) ?? null,
      }),
    );
    return { agents, models };
  }
}
