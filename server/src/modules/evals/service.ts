import { z } from 'zod';
import type {
  EvalCaseDraft,
  EvalCaseMeta,
  EvalCaseView,
  EvalCompare,
  EvalOverview,
  EvalRunPage,
  EvalRunStartResponse,
  EvalSuiteRunDetail,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { loadDiff } from '../reviews/diff-loader.js';
import {
  EVAL_CASE_TIMEOUT_MS,
  EVAL_MAX_CASES_PER_AGENT,
  EVAL_MAX_CASES_PER_RUN,
  EVAL_MAX_RUNNING_PER_WORKSPACE,
  EVAL_RUN_CONCURRENCY,
} from './constants.js';
import { draftFromFinding } from './draft.js';
import { finalizeRun } from './finalize.js';
import { runEndLine, runStartLine } from './log-lines.js';
import { buildManifest } from '../../platform/agent-config.js';
import { EvalsRepository, isUniqueViolation, type EvalsStore } from './repository.js';
import { runEvalCases, sanitizeError, type RunnableCase } from './runner.js';
import { validateCaseInput } from './validate.js';

/** The slice of a pino/fastify logger the service writes to. */
export interface EvalLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

const Uuid = z.string().uuid();
const KIND_ORDER = { must_find: 0, must_not_flag: 1 } as const;

const notFound = () => new NotFoundError('Not found');
const invalidCase = (reasons: string[]) =>
  new AppError('invalid_eval_case', `Invalid eval case: ${reasons.join('; ')}`, 400, { reasons });

/**
 * Eval pipeline service. Onion: routes -> service -> repository (`EvalsStore`); the only
 * adapter is the LLM provider, resolved through the container. Every read and write is
 * workspace-scoped; an unknown id and another workspace's id both answer 404 (AC-79).
 */
export class EvalsService {
  private store: EvalsStore;

  constructor(
    private container: Container,
    store?: EvalsStore,
  ) {
    this.store = store ?? new EvalsRepository(container.db);
  }

  // ---- cases ----------------------------------------------------------------

  /** AC-3..AC-6, AC-11: a read-only draft built from a decided finding. */
  async draft(workspaceId: string, findingId: string): Promise<EvalCaseDraft> {
    const ctx = await this.store.findFindingWithContext(workspaceId, findingId);
    if (!ctx) throw notFound();
    const decision = decisionOf(ctx.finding);
    if (!decision) {
      throw new AppError('finding_undecided', 'Accept or dismiss the finding before turning it into an eval case', 409);
    }
    const diff = await loadDiff(this.container, this.store, workspaceId, ctx.pull, ctx.repo);
    const out = draftFromFinding({
      finding: {
        id: ctx.finding.id,
        pr_id: ctx.pull.id,
        title: ctx.finding.title,
        file: ctx.finding.file,
        start_line: ctx.finding.startLine,
        end_line: ctx.finding.endLine,
      },
      decision,
      rawDiff: diff.raw,
      agentId: ctx.agentId,
      existing: await this.store.existingCasesForFinding(workspaceId, findingId),
    });
    if ('error' in out) throw new AppError(out.error, out.message, 422);
    return out.draft;
  }

  /** AC-8, AC-10, AC-14: validate, then store one case owned by the finding's agent. */
  async createCase(workspaceId: string, body: unknown): Promise<EvalCaseView> {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const agentId = Uuid.safeParse(b.agent_id);
    const findingId = Uuid.safeParse(b.finding_id);
    const idReasons = [
      ...(agentId.success ? [] : ['agent_id must be a UUID']),
      ...(findingId.success ? [] : ['finding_id must be a UUID']),
    ];
    if (!agentId.success || !findingId.success) throw invalidCase(idReasons);

    const agent = await this.store.getAgent(workspaceId, agentId.data);
    if (!agent) throw notFound();
    const ctx = await this.store.findFindingWithContext(workspaceId, findingId.data);
    if (!ctx) throw notFound();

    const input = b as Parameters<typeof validateCaseInput>[0];
    const reasons = validateCaseInput(input);
    if (ctx.agentId !== agent.id) reasons.push('agent_id must be the agent that produced the finding');
    // The client-sent fragment is kept as is (the PR may have moved on since the draft), but the
    // expectation must still point at the finding it claims to come from.
    const claimed = input.expectation;
    if (
      claimed &&
      (claimed.file !== ctx.finding.file ||
        claimed.start_line !== ctx.finding.startLine ||
        claimed.end_line !== ctx.finding.endLine)
    ) {
      reasons.push("expectation file and lines must match the source finding's");
    }
    if (reasons.length > 0) throw invalidCase(reasons);

    const decision = decisionOf(ctx.finding);
    if (!decision) {
      throw new AppError('finding_undecided', 'Accept or dismiss the finding before turning it into an eval case', 409);
    }
    const existing = (await this.store.existingCasesForFinding(workspaceId, findingId.data)).find(
      (c) => c.agent_id === agent.id,
    );
    if (existing) throw alreadyExists(existing.case_id);
    if ((await this.store.countCases(workspaceId, agent.id)) >= EVAL_MAX_CASES_PER_AGENT) {
      throw new AppError(
        'eval_case_limit',
        `This agent already has the maximum of ${EVAL_MAX_CASES_PER_AGENT} eval cases`,
        409,
      );
    }

    const meta: EvalCaseMeta = {
      origin: decision === 'accepted' ? 'accepted_finding' : 'dismissed_finding',
      source_finding_id: ctx.finding.id,
      source_pr_id: ctx.pull.id,
      source_decision: decision,
    };
    const e = (input.expectation ?? {}) as { kind: 'must_find' | 'must_not_flag'; file: string; start_line: number; end_line: number };
    try {
      return await this.store.insertCase({
        workspaceId,
        agentId: agent.id,
        name: (input.name as string).trim(),
        expectation: { kind: e.kind, file: e.file, start_line: e.start_line, end_line: e.end_line },
        inputDiff: input.input_diff as string,
        notes: typeof b.notes === 'string' ? b.notes : null,
        meta,
      });
    } catch (err) {
      // The DB-level unique index closes the race between the check above and the insert.
      if (isUniqueViolation(err)) {
        const again = (await this.store.existingCasesForFinding(workspaceId, findingId.data)).find(
          (c) => c.agent_id === agent.id,
        );
        throw alreadyExists(again?.case_id ?? null);
      }
      throw err;
    }
  }

  async listCases(workspaceId: string, agentId: string): Promise<EvalCaseView[]> {
    if (!(await this.store.getAgent(workspaceId, agentId))) throw notFound();
    const cases = await this.store.listCases(workspaceId, agentId);
    return [...cases].sort(
      (a, b) =>
        KIND_ORDER[a.expectation.kind] - KIND_ORDER[b.expectation.kind] || a.name.localeCompare(b.name),
    );
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<{ ok: true }> {
    if (!(await this.store.deleteCase(workspaceId, caseId))) throw notFound();
    return { ok: true };
  }

  // ---- runs -----------------------------------------------------------------

  /**
   * AC-32, AC-41..AC-44. Checks run in this order and none writes anything:
   * unknown agent (404), no cases (400), too many cases (400), run already running (409), workspace run limit (409),
   * missing provider key (the container's ConfigError, unchanged: A-2). Then the manifest
   * and the skill bodies are captured, the rows are created, and the cases run in the
   * background after the 202.
   * An optional `modelOverride` replaces the model in the recorded manifest for this run only.
   */
  async startRun(
    workspaceId: string,
    agentId: string,
    log: EvalLogger,
    modelOverride?: string,
  ): Promise<EvalRunStartResponse> {
    const agent = await this.store.getAgent(workspaceId, agentId);
    if (!agent) throw notFound();

    const total = await this.store.countCases(workspaceId, agentId);
    assertCaseCount(total);
    const running = await this.store.findRunningRun(workspaceId, agentId);
    if (running) throw alreadyRunning(running);

    if ((await this.store.countRunningRuns(workspaceId)) >= EVAL_MAX_RUNNING_PER_WORKSPACE) {
      throw new AppError(
        'eval_run_limit',
        `At most ${EVAL_MAX_RUNNING_PER_WORKSPACE} eval runs can run at once; wait for one to finish`,
        409,
      );
    }

    const llm = await this.container.llm(agent.provider);

    const cases = await this.store.loadCases(workspaceId, agentId);
    assertCaseCount(cases.length);
    const linked = await this.store.linkedSkills(agent.id);
    const enabled = linked.filter((s) => s.enabled);
    // The override replaces only the manifest's model (same provider); the agent row and its version stay as they are.
    const manifest = buildManifest(agent, linked.map((s) => s.id), enabled);
    if (modelOverride && modelOverride !== agent.model) manifest.model = modelOverride;

    let created;
    try {
      created = await this.store.createSuiteRun({
        workspaceId,
        agentId: agent.id,
        agentVersion: agent.version,
        manifest,
        cases,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw alreadyRunning((await this.store.findRunningRun(workspaceId, agentId)) ?? null);
      }
      throw err;
    }

    const runnable: RunnableCase[] = cases.map((c, i) => ({
      id: created.resultIds[i]!,
      case_id: c.id,
      name: c.name,
      expectation: c.expectation,
      origin: c.meta.origin,
      input_diff: c.input_diff,
    }));
    // Fire and forget: errors are handled inside (the run is marked failed).
    void this.execute({
      runId: created.runId,
      agentName: agent.name,
      agentVersion: agent.version,
      manifest,
      skillBodies: enabled.map((s) => s.body),
      llm,
      cases: runnable,
      log,
    });
    return { run_id: created.runId };
  }

  private async execute(a: {
    runId: string;
    agentName: string;
    agentVersion: number;
    manifest: ReturnType<typeof buildManifest>;
    skillBodies: string[];
    llm: Awaited<ReturnType<Container['llm']>>;
    cases: RunnableCase[];
    log: EvalLogger;
  }): Promise<void> {
    const ids = { runId: a.runId, step: 'eval' };
    try {
      a.log.info(
        ids,
        runStartLine({ agent: a.agentName, version: a.agentVersion, cases: a.cases.length, model: a.manifest.model }),
      );
      const results = await runEvalCases({
        cases: a.cases,
        manifest: a.manifest,
        skillBodies: a.skillBodies,
        llm: a.llm,
        concurrency: EVAL_RUN_CONCURRENCY,
        timeoutMs: EVAL_CASE_TIMEOUT_MS,
        onResult: (r) => this.store.saveCaseResult(r),
        log: (line) => a.log.warn(ids, line),
      });
      const fin = finalizeRun(results);
      await this.store.finishSuiteRun(a.runId, fin);
      a.log.info(ids, runEndLine({ status: fin.status, metrics: fin.metrics, durationMs: fin.durationMs, cost: fin.costUsd }));
    } catch (err) {
      const reason = sanitizeError(err);
      a.log.warn(ids, `eval.run failed: ${reason}`);
      try {
        await this.store.failRun(a.runId, reason);
      } catch (e2) {
        a.log.warn(ids, `eval.run could not be marked failed: ${sanitizeError(e2)}`);
      }
    }
  }

  async listRuns(
    workspaceId: string,
    agentId: string,
    cursor: string | null,
    limit: number,
  ): Promise<EvalRunPage> {
    if (!(await this.store.getAgent(workspaceId, agentId))) throw notFound();
    const page = await this.store.listRuns(workspaceId, agentId, cursor, limit);
    if (page === 'bad_cursor') throw new AppError('invalid_cursor', 'Invalid cursor', 400);
    return page;
  }

  async getRun(workspaceId: string, runId: string): Promise<EvalSuiteRunDetail> {
    const run = await this.store.getRunDetail(workspaceId, runId);
    if (!run) throw notFound();
    return run;
  }

  overview(workspaceId: string): Promise<EvalOverview> {
    return this.store.overview(workspaceId);
  }

  /** `a` is the older run by `started_at`; runs of different agents are not comparable. */
  async compare(workspaceId: string, idA: string, idB: string): Promise<EvalCompare> {
    const [x, y] = await Promise.all([this.getRun(workspaceId, idA), this.getRun(workspaceId, idB)]);
    if (x.agent_id !== y.agent_id) {
      throw new AppError('runs_not_comparable', 'The two runs belong to different agents', 400);
    }
    return Date.parse(x.started_at) <= Date.parse(y.started_at) ? { a: x, b: y } : { a: y, b: x };
  }

  /** AC-47: runs left `running` by a dead process become `failed` / "interrupted". */
  reapInterrupted(): Promise<number> {
    return this.store.reapInterrupted();
  }
}

function decisionOf(f: { acceptedAt: Date | null; dismissedAt: Date | null }): 'accepted' | 'dismissed' | null {
  if (f.acceptedAt && !f.dismissedAt) return 'accepted';
  if (f.dismissedAt && !f.acceptedAt) return 'dismissed';
  if (f.acceptedAt && f.dismissedAt) return f.acceptedAt >= f.dismissedAt ? 'accepted' : 'dismissed';
  return null;
}

function assertCaseCount(n: number): void {
  if (n === 0) throw new AppError('no_eval_cases', 'No eval cases for this agent', 400);
  if (n > EVAL_MAX_CASES_PER_RUN) {
    throw new AppError('too_many_eval_cases', `Too many eval cases (limit ${EVAL_MAX_CASES_PER_RUN})`, 400);
  }
}

const alreadyRunning = (runId: string | null) =>
  new AppError('eval_run_running', 'An eval run is already running for this agent', 409, { running_run_id: runId });

const alreadyExists = (caseId: string | null) =>
  new AppError('eval_case_exists', 'An eval case already exists for this finding', 409, { case_id: caseId });

