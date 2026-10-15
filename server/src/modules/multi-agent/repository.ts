import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ChildRun, ParentRun, ReviewWithFindings } from './read-model.js';
import type { EstimateRow } from './estimates.js';

/** Read-only data access for the multi-agent view (no writes, ever). */
export class MultiAgentRepository {
  constructor(private db: Db) {}

  async getParent(workspaceId: string, id: string): Promise<ParentRun | undefined> {
    const [row] = await this.db
      .select({ id: t.multiAgentRuns.id, prId: t.multiAgentRuns.prId, ranAt: t.multiAgentRuns.ranAt })
      .from(t.multiAgentRuns)
      .where(and(eq(t.multiAgentRuns.id, id), eq(t.multiAgentRuns.workspaceId, workspaceId)));
    return row;
  }

  /** Child agent runs with the agent name (null when the agent was deleted). */
  async childRuns(workspaceId: string, multiAgentRunId: string): Promise<ChildRun[]> {
    const rows = await this.db
      .select({ run: t.agentRuns, agentName: t.agents.name })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.multiAgentRunId, multiAgentRunId),
        ),
      );
    return rows.map(({ run, agentName }) => ({
      id: run.id,
      agentId: run.agentId,
      agentName: agentName ?? null,
      provider: run.provider,
      model: run.model,
      status: run.status,
      error: run.error,
      durationMs: run.durationMs,
      costUsd: run.costUsd,
      score: run.score,
      ranAt: run.ranAt,
    }));
  }

  /** Reviews (with their findings) produced by the given runs. */
  async reviewsForRuns(workspaceId: string, runIds: string[]): Promise<ReviewWithFindings[]> {
    if (runIds.length === 0) return [];
    const reviews = await this.db
      .select()
      .from(t.reviews)
      .where(and(eq(t.reviews.workspaceId, workspaceId), inArray(t.reviews.runId, runIds)));
    if (reviews.length === 0) return [];
    const findings = await this.db
      .select()
      .from(t.findings)
      .where(inArray(t.findings.reviewId, reviews.map((r) => r.id)));
    return reviews.map((review) => ({
      review,
      findings: findings.filter((f) => f.reviewId === review.id),
    }));
  }

  async pullNumber(prId: string): Promise<number | null> {
    const [row] = await this.db
      .select({ number: t.pullRequests.number })
      .from(t.pullRequests)
      .where(eq(t.pullRequests.id, prId));
    return row?.number ?? null;
  }

  /** The agent's latest `limit` done runs (newest first). */
  async lastDoneRuns(workspaceId: string, agentId: string, limit: number): Promise<EstimateRow[]> {
    const rows = await this.db
      .select({ durationMs: t.agentRuns.durationMs, costUsd: t.agentRuns.costUsd })
      .from(t.agentRuns)
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.agentId, agentId),
          eq(t.agentRuns.status, 'done'),
        ),
      )
      .orderBy(desc(t.agentRuns.ranAt))
      .limit(limit);
    return rows.map((r) => ({ duration_ms: r.durationMs, cost_usd: r.costUsd }));
  }
}
