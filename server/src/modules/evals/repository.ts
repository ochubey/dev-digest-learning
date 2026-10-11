import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type {
  EvalCaseMeta,
  EvalCaseResult,
  EvalExpectation,
  EvalCaseView,
  EvalOverview,
  EvalRunManifest,
  EvalRunPage,
  EvalSuiteRun,
  EvalSuiteRunDetail,
} from '@devdigest/shared';
import type { DbOrTx } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AgentRow, PullRow } from '../../db/rows.js';
import { AgentsRepository } from '../agents/repository.js';
import type { FinalizedRun } from './finalize.js';
import {
  toCaseView,
  toLastResult,
  toStoredCase,
  toSuiteRun,
  toSuiteRunDetail,
  type ResultRowLike,
  type StoredCase,
} from './mappers.js';

export type { StoredCase };

export type RepoRow = typeof t.repos.$inferSelect;

export interface FindingContext {
  finding: {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    title: string;
    acceptedAt: Date | null;
    dismissedAt: Date | null;
  };
  /** The agent that produced the finding's review; null for seed/unattributed reviews. */
  agentId: string | null;
  pull: PullRow;
  repo: RepoRow;
}

export interface LinkedSkill {
  id: string;
  name: string;
  version: number;
  enabled: boolean;
  body: string;
}

export interface NewCase {
  workspaceId: string;
  agentId: string;
  name: string;
  expectation: EvalExpectation;
  inputDiff: string;
  notes: string | null;
  meta: EvalCaseMeta;
}

export interface NewSuiteRun {
  workspaceId: string;
  agentId: string;
  agentVersion: number;
  manifest: EvalRunManifest;
  cases: StoredCase[];
}

/** Data access the evals service depends on; tests substitute an in-memory one. */
export interface EvalsStore {
  // ---- agents (workspace-scoped reads) ----
  getAgent(workspaceId: string, agentId: string): Promise<AgentRow | undefined>;
  listAgents(workspaceId: string): Promise<AgentRow[]>;
  /** Linked skills in link order, enabled or not. */
  linkedSkills(agentId: string): Promise<LinkedSkill[]>;
  // ---- cases ----
  findFindingWithContext(workspaceId: string, findingId: string): Promise<FindingContext | undefined>;
  existingCasesForFinding(workspaceId: string, findingId: string): Promise<{ agent_id: string; case_id: string }[]>;
  getPrFiles(prId: string): Promise<(typeof t.prFiles.$inferSelect)[]>;
  listCases(workspaceId: string, agentId: string): Promise<EvalCaseView[]>;
  countCases(workspaceId: string, agentId: string): Promise<number>;
  loadCases(workspaceId: string, agentId: string): Promise<StoredCase[]>;
  insertCase(values: NewCase): Promise<EvalCaseView>;
  deleteCase(workspaceId: string, caseId: string): Promise<boolean>;
  // ---- runs ----
  findRunningRun(workspaceId: string, agentId: string): Promise<string | undefined>;
  /** Runs currently `running` in the workspace (any agent). */
  countRunningRuns(workspaceId: string): Promise<number>;
  /** Creates the running suite row plus one pending result per case, atomically. */
  createSuiteRun(values: NewSuiteRun): Promise<{ runId: string; resultIds: string[] }>;
  saveCaseResult(result: EvalCaseResult): Promise<void>;
  finishSuiteRun(runId: string, final: FinalizedRun): Promise<void>;
  /** Marks the run `failed` with a reason; its pending results become `error`. */
  failRun(runId: string, reason: string): Promise<void>;
  listRuns(workspaceId: string, agentId: string, cursor: string | null, limit: number): Promise<EvalRunPage | 'bad_cursor'>;
  getRunDetail(workspaceId: string, runId: string): Promise<EvalSuiteRunDetail | undefined>;
  overview(workspaceId: string): Promise<EvalOverview>;
  /** Boot reaper (AC-47): every `running` run becomes `failed` / "interrupted". Returns the count. */
  reapInterrupted(): Promise<number>;
  /** Removes an agent's cases (runs and results go with the agent row via FK cascade). */
  deleteForAgent(agentId: string): Promise<void>;
}

export const OVERVIEW_RECENT_RUNS = 6;
export const INTERRUPTED_REASON = 'interrupted';

/** Postgres unique-violation, possibly wrapped by drizzle's query error. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

const MAX_CURSOR_LENGTH = 200;

const encodeCursor = (startedAt: Date, id: string) =>
  Buffer.from(`${startedAt.toISOString()}|${id}`).toString('base64url');

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function decodeCursor(cursor: string): { at: string; id: string } | null {
  if (cursor.length > MAX_CURSOR_LENGTH) return null;
  const parts = Buffer.from(cursor, 'base64url').toString().split('|');
  if (parts.length !== 2) return null;
  const [at, id] = parts as [string, string];
  // Strict: only what `encodeCursor` emits (canonical ISO-8601 UTC), so nothing odd reaches SQL.
  if (!ISO_UTC.test(at) || new Date(at).toISOString() !== at) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return { at, id };
}

export class EvalsRepository implements EvalsStore {
  private agents: AgentsRepository;

  constructor(private db: DbOrTx) {
    this.agents = new AgentsRepository(db);
  }

  // ---- agents ---------------------------------------------------------------

  getAgent(workspaceId: string, agentId: string): Promise<AgentRow | undefined> {
    return this.agents.getById(workspaceId, agentId);
  }

  listAgents(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(asc(t.agents.name));
  }

  async linkedSkills(agentId: string): Promise<LinkedSkill[]> {
    const links = await this.agents.linkedSkills(agentId);
    return links.map((l) => ({
      id: l.skill.id,
      name: l.skill.name,
      version: l.skill.version,
      enabled: l.skill.enabled,
      body: l.skill.body,
    }));
  }

  // ---- cases ----------------------------------------------------------------

  async findFindingWithContext(workspaceId: string, findingId: string): Promise<FindingContext | undefined> {
    const [row] = await this.db
      .select({ finding: t.findings, review: t.reviews, pull: t.pullRequests, repo: t.repos })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.findings.reviewId, t.reviews.id))
      .innerJoin(t.pullRequests, eq(t.reviews.prId, t.pullRequests.id))
      .innerJoin(t.repos, eq(t.pullRequests.repoId, t.repos.id))
      .where(and(eq(t.findings.id, findingId), eq(t.pullRequests.workspaceId, workspaceId)));
    if (!row) return undefined;
    return {
      finding: {
        id: row.finding.id,
        file: row.finding.file,
        startLine: row.finding.startLine,
        endLine: row.finding.endLine,
        title: row.finding.title,
        acceptedAt: row.finding.acceptedAt,
        dismissedAt: row.finding.dismissedAt,
      },
      agentId: row.review.agentId,
      pull: row.pull,
      repo: row.repo,
    };
  }

  getPrFiles(prId: string): Promise<(typeof t.prFiles.$inferSelect)[]> {
    return this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
  }

  async existingCasesForFinding(workspaceId: string, findingId: string) {
    const rows = await this.db
      .select({ id: t.evalCases.id, ownerId: t.evalCases.ownerId })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          sql`${t.evalCases.inputMeta}->>'source_finding_id' = ${findingId}`,
        ),
      );
    return rows.map((r) => ({ agent_id: r.ownerId, case_id: r.id }));
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseView[]> {
    const cases = await this.loadCases(workspaceId, agentId);
    if (cases.length === 0) return [];
    const rows = await this.db
      .select()
      .from(t.evalRuns)
      .where(
        and(
          inArray(t.evalRuns.caseId, cases.map((c) => c.id)),
          ne(t.evalRuns.status, 'pending'),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt));
    const lastByCase = new Map<string, ResultRowLike>();
    for (const r of rows) if (r.caseId && !lastByCase.has(r.caseId)) lastByCase.set(r.caseId, r);
    return cases.map((c) => {
      const last = lastByCase.get(c.id);
      return toCaseView(c, last?.suiteRunId ? toLastResult(last.suiteRunId, last) : null);
    });
  }

  async countCases(workspaceId: string, agentId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.evalCases)
      .where(this.agentCases(workspaceId, agentId));
    return row?.n ?? 0;
  }

  async loadCases(workspaceId: string, agentId: string): Promise<StoredCase[]> {
    const rows = await this.db
      .select()
      .from(t.evalCases)
      .where(this.agentCases(workspaceId, agentId))
      .orderBy(asc(t.evalCases.name), asc(t.evalCases.id));
    return rows.map(toStoredCase);
  }

  async insertCase(values: NewCase): Promise<EvalCaseView> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: 'agent',
        ownerId: values.agentId,
        name: values.name,
        inputDiff: values.inputDiff,
        inputMeta: values.meta,
        expectedOutput: values.expectation,
        notes: values.notes,
      })
      .returning();
    return toCaseView(toStoredCase(row!), null);
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- runs -----------------------------------------------------------------

  async findRunningRun(workspaceId: string, agentId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: t.evalSuiteRuns.id })
      .from(t.evalSuiteRuns)
      .where(
        and(
          eq(t.evalSuiteRuns.workspaceId, workspaceId),
          eq(t.evalSuiteRuns.agentId, agentId),
          eq(t.evalSuiteRuns.status, 'running'),
        ),
      );
    return row?.id;
  }

  async countRunningRuns(workspaceId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.evalSuiteRuns)
      .where(and(eq(t.evalSuiteRuns.workspaceId, workspaceId), eq(t.evalSuiteRuns.status, 'running')));
    return row?.n ?? 0;
  }

  async createSuiteRun(values: NewSuiteRun): Promise<{ runId: string; resultIds: string[] }> {
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(t.evalSuiteRuns)
        .values({
          workspaceId: values.workspaceId,
          agentId: values.agentId,
          agentVersion: values.agentVersion,
          manifest: values.manifest,
          status: 'running',
          casesTotal: values.cases.length,
          // Set from JS (ms precision) so the keyset cursor round-trips exactly.
          startedAt: new Date(),
        })
        .returning({ id: t.evalSuiteRuns.id });
      const rows = await tx
        .insert(t.evalRuns)
        .values(
          values.cases.map((c) => ({
            caseId: c.id,
            suiteRunId: run!.id,
            status: 'pending' as const,
            caseSnapshot: { name: c.name, expectation: c.expectation, origin: c.meta.origin },
          })),
        )
        .returning({ id: t.evalRuns.id, caseId: t.evalRuns.caseId });
      const byCase = new Map(rows.map((r) => [r.caseId, r.id]));
      return { runId: run!.id, resultIds: values.cases.map((c) => byCase.get(c.id)!) };
    });
  }

  async saveCaseResult(r: EvalCaseResult): Promise<void> {
    await this.db
      .update(t.evalRuns)
      .set({
        status: r.status,
        pass: r.pass,
        actualOutput: { grounded: r.grounded, dropped: r.dropped },
        durationMs: r.duration_ms,
        tokensIn: r.tokens_in,
        tokensOut: r.tokens_out,
        costUsd: r.cost_usd,
        error: r.error,
        ranAt: new Date(),
      })
      .where(eq(t.evalRuns.id, r.id));
  }

  async finishSuiteRun(runId: string, f: FinalizedRun): Promise<void> {
    await this.db
      .update(t.evalSuiteRuns)
      .set({
        status: f.status,
        recall: f.metrics.recall,
        precision: f.metrics.precision,
        citationAccuracy: f.metrics.citation_accuracy,
        counts: f.counts,
        durationMs: f.durationMs,
        costUsd: f.costUsd,
        finishedAt: new Date(),
      })
      .where(and(eq(t.evalSuiteRuns.id, runId), eq(t.evalSuiteRuns.status, 'running')));
  }

  async failRun(runId: string, reason: string): Promise<void> {
    await this.failRuns([runId], reason);
  }

  async reapInterrupted(): Promise<number> {
    const running = await this.db
      .select({ id: t.evalSuiteRuns.id })
      .from(t.evalSuiteRuns)
      .where(eq(t.evalSuiteRuns.status, 'running'));
    if (running.length === 0) return 0;
    return this.failRuns(
      running.map((r) => r.id),
      INTERRUPTED_REASON,
    );
  }

  private failRuns(ids: string[], reason: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(t.evalRuns)
        .set({ status: 'error', error: reason })
        .where(and(inArray(t.evalRuns.suiteRunId, ids), eq(t.evalRuns.status, 'pending')));
      const rows = await tx
        .update(t.evalSuiteRuns)
        .set({ status: 'failed', error: reason, finishedAt: new Date() })
        .where(and(inArray(t.evalSuiteRuns.id, ids), eq(t.evalSuiteRuns.status, 'running')))
        .returning({ id: t.evalSuiteRuns.id });
      return rows.length;
    });
  }

  async listRuns(
    workspaceId: string,
    agentId: string,
    cursor: string | null,
    limit: number,
  ): Promise<EvalRunPage | 'bad_cursor'> {
    const parsed = cursor ? decodeCursor(cursor) : null;
    if (cursor && !parsed) return 'bad_cursor';
    const rows = await this.db
      .select({ run: t.evalSuiteRuns, agentName: t.agents.name })
      .from(t.evalSuiteRuns)
      .innerJoin(t.agents, eq(t.evalSuiteRuns.agentId, t.agents.id))
      .where(
        and(
          eq(t.evalSuiteRuns.workspaceId, workspaceId),
          eq(t.evalSuiteRuns.agentId, agentId),
          parsed
            ? sql`(${t.evalSuiteRuns.startedAt}, ${t.evalSuiteRuns.id}) < (${parsed.at}::timestamptz, ${parsed.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(t.evalSuiteRuns.startedAt), desc(t.evalSuiteRuns.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const done = await this.doneCounts(page.map((r) => r.run.id));
    const items = page.map((r) => toSuiteRun(r.run, done.get(r.run.id) ?? 0, r.agentName));
    const last = page.at(-1);
    return {
      items,
      next_cursor: rows.length > limit && last ? encodeCursor(last.run.startedAt, last.run.id) : null,
    };
  }

  async getRunDetail(workspaceId: string, runId: string): Promise<EvalSuiteRunDetail | undefined> {
    const [row] = await this.db
      .select({ run: t.evalSuiteRuns, agentName: t.agents.name })
      .from(t.evalSuiteRuns)
      .innerJoin(t.agents, eq(t.evalSuiteRuns.agentId, t.agents.id))
      .where(and(eq(t.evalSuiteRuns.id, runId), eq(t.evalSuiteRuns.workspaceId, workspaceId)));
    if (!row) return undefined;
    const results = await this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.suiteRunId, runId))
      .orderBy(asc(sql`${t.evalRuns.caseSnapshot}->>'name'`), asc(t.evalRuns.id));
    return toSuiteRunDetail(row.run, results, row.agentName);
  }

  async overview(workspaceId: string): Promise<EvalOverview> {
    const agents = await this.listAgents(workspaceId);
    const finished = (agentId: string) =>
      this.db
        .select()
        .from(t.evalSuiteRuns)
        .where(
          and(
            eq(t.evalSuiteRuns.workspaceId, workspaceId),
            eq(t.evalSuiteRuns.agentId, agentId),
            // AC-51: only completed / completed_with_errors runs count as finished.
            inArray(t.evalSuiteRuns.status, ['completed', 'completed_with_errors']),
          ),
        )
        .orderBy(desc(t.evalSuiteRuns.startedAt), desc(t.evalSuiteRuns.id))
        .limit(2);
    const perAgent = await Promise.all(agents.map((a) => finished(a.id)));
    const recentRows = await this.db
      .select({ run: t.evalSuiteRuns, agentName: t.agents.name })
      .from(t.evalSuiteRuns)
      .innerJoin(t.agents, eq(t.evalSuiteRuns.agentId, t.agents.id))
      .where(eq(t.evalSuiteRuns.workspaceId, workspaceId))
      .orderBy(desc(t.evalSuiteRuns.startedAt), desc(t.evalSuiteRuns.id))
      .limit(OVERVIEW_RECENT_RUNS);
    const ids = [...perAgent.flat().map((r) => r.id), ...recentRows.map((r) => r.run.id)];
    const done = await this.doneCounts(ids);
    const view = (r: typeof t.evalSuiteRuns.$inferSelect, name: string): EvalSuiteRun =>
      toSuiteRun(r, done.get(r.id) ?? 0, name);
    return {
      agents: agents.map((a, i) => ({
        agent_id: a.id,
        name: a.name,
        model: a.model,
        version: a.version,
        latest: perAgent[i]![0] ? view(perAgent[i]![0], a.name) : null,
        previous: perAgent[i]![1] ? view(perAgent[i]![1], a.name) : null,
      })),
      recent: recentRows.map((r) => view(r.run, r.agentName)),
    };
  }

  async deleteForAgent(agentId: string): Promise<void> {
    // Suite runs and their results cascade from the agent row; cases only reference it by owner_id.
    await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.ownerKind, 'agent'), eq(t.evalCases.ownerId, agentId)));
  }

  /** Finished (non-pending) result rows per suite run: the run's `cases_done`. */
  private async doneCounts(runIds: string[]): Promise<Map<string, number>> {
    if (runIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: t.evalRuns.suiteRunId, n: sql<number>`count(*)::int` })
      .from(t.evalRuns)
      .where(and(inArray(t.evalRuns.suiteRunId, runIds), ne(t.evalRuns.status, 'pending')))
      .groupBy(t.evalRuns.suiteRunId);
    return new Map(rows.map((r) => [r.id!, r.n]));
  }

  private agentCases(workspaceId: string, agentId: string) {
    return and(
      eq(t.evalCases.workspaceId, workspaceId),
      eq(t.evalCases.ownerKind, 'agent'),
      eq(t.evalCases.ownerId, agentId),
    );
  }
}
