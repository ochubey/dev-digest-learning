import type { Container } from '../../platform/container.js';
import type { Intent, Provider, Review, RunTrace, UnifiedDiff } from '@devdigest/shared';
import { reviewPullRequest, countBlockers, type ReviewOutcome } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import * as schema from '../../db/schema.js';
import type { AgentRow } from '../../db/rows.js';
import type { ReviewRepository, FindingRow, PullRow, ReviewRow } from './repository.js';
import { REVIEW_STRATEGY } from './constants.js';
import { taskLine } from './helpers.js';
import { loadDiff } from './diff-loader.js';
import { rollupSeverities } from '../pulls/status.js';
import { IntentService } from '../intent/service.js';
import { loadLine, resolveRefsLine, llmDetails, llmCallsLine, reviewIntentPolicy } from '../intent/log-lines.js';
import { intentFilesFromDiff } from '../intent/diff-files.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { effectiveDocs } from '../project-context/effective.js';
import type { ProjectDocsSource } from '../project-context/ports.js';
import { resolveProjectContext, type ResolvedProjectContext } from '../project-context/resolver.js';
import { projectContextSummaryLine, projectContextSkipLine } from '../project-context/log-lines.js';
import { randomUUID } from 'node:crypto';

/** Thrown by a run when the user cancels it mid-flight (between map files). */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

/** How the run's intent was obtained (drives the llm.calls log line). */
export type IntentStatus = 'derived' | 'cached' | 'failed';

/** Result of the once-per-run intent step (fail-open: `intent` is absent on failure). */
export interface IntentOutcome {
  intent?: Intent;
  status: IntentStatus;
  /** Structured LLM attempts actually made for intent (0 for cache hit / failed before the call). */
  attempts: number;
}

interface DeriveIntentParams {
  workspaceId: string;
  pull: PullRow;
  repo: typeof schema.repos.$inferSelect;
  /** The diff this run loaded: the single source of files + hunk headers for the intent. */
  diff: UnifiedDiff;
  runLog: RunLogger;
  correlationId: string;
  logger?: Logger;
  /** Main review model: used (with a warning) if the standard feature model is unavailable. */
  fallback?: { provider: Provider; model: string };
}

interface RunOneAgentParams {
  workspaceId: string;
  pull: PullRow;
  repo: typeof schema.repos.$inferSelect;
  diff: UnifiedDiff;
  agent: AgentRow;
  runId: string;
  /** The fanned-out pre-work logger; narrowed to this run inside. */
  parentLog: RunLogger;
  intent: IntentOutcome;
  correlationId: string;
  logger?: Logger;
}

/** Prompt sections that may be absent (null) in the assembly; system + user are always present. */
const OPTIONAL_PROMPT_SECTIONS = [
  'skills',
  'memory',
  'specs',
  'repo_map',
  'callers',
  'pr_description',
  'intent',
] as const;
const ALWAYS_PRESENT_SECTIONS = 2;

/**
 * The three per-run observability blocks. Human lines go to runLog (Live Log +
 * trace); `scope.apply` is structured pino meta ONLY — the human scope line is
 * the engine's own `Scope policy:` event (forwarded by runLog.event), not repeated.
 */
function logRunMetrics(
  runLog: RunLogger,
  logger: Logger | undefined,
  m: {
    runId: string;
    model: string;
    outcome: ReviewOutcome;
    reviewDurationMs: number;
    intent: IntentOutcome;
    correlationId: string;
  },
): void {
  const { outcome, intent, correlationId } = m;

  const estimatedTokens = outcome.assembly.user?.length ? Math.ceil(outcome.assembly.user.length / 3) : 0;
  const sectionsCount =
    OPTIONAL_PROMPT_SECTIONS.filter((k) => outcome.assembly[k] !== null).length + ALWAYS_PRESENT_SECTIONS;
  runLog.info(
    `review.assemble: model=${m.model}, estimated_tokens=${estimatedTokens}, duration=${m.reviewDurationMs}ms, sections=${sectionsCount}`,
    {
      step: 'review.assemble',
      model: m.model,
      durationMs: m.reviewDurationMs,
      estimatedTokens,
      sectionsCount,
      correlationId,
      costUsd: outcome.costUsd,
    },
  );

  logger?.info({ step: 'scope.apply', runId: m.runId, ...outcome.scope, correlationId }, 'scope.apply');

  // intent= distinguishes attempts from successes (ok / cached / skipped / failed), see intentCallsLabel.
  runLog.info(llmCallsLine(intent, outcome.llmCalls), {
    step: 'llm.calls',
    intent: intent.status,
    intentCalls: intent.attempts,
    review: outcome.llmCalls,
    correlationId,
  });
}

/** `project_context` trace block; absent (not null) when the run had no project context. */
function projectContextSummary(pc?: ResolvedProjectContext): Pick<RunTrace, 'project_context'> | Record<string, never> {
  return pc
    ? {
        project_context: {
          commit_sha: pc.commitSha,
          injected_tokens: pc.injectedTokens,
          soft_cap_exceeded: pc.softCapExceeded,
        },
      }
    : {};
}

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRow;
  findings: FindingRow[];
  grounding: string;
  raw: Review;
};

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
    private agents: Container['agentsRepo'],
  ) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: PullRow,
    repo: typeof schema.repos.$inferSelect,
    jobs: { agent: AgentRow; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // Correlation ID for tracing this PR's prompt assembly across logs (intent + all agents).
    const correlationId = randomUUID();

    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.container.runBus,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id, correlationId },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        await this.repo
          .completeAgentRun(runId, {
            status: 'failed',
            durationMs: 0,
            tokensIn: 0,
            tokensOut: 0,
            findingsCount: 0,
            grounding: '0/0 passed',
            error: msg,
          })
          .catch(() => undefined);
        await this.repo
          .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed'))
          .catch(() => undefined);
        this.container.runBus.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => loadDiff(this.container, this.repo, workspaceId, pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    // Derive intent when none exists or the PR head SHA changed; otherwise reuse it.
    // Re-deriving is the manual Regenerate button only (POST /pulls/:id/intent/derive).
    const firstAgent = jobs[0]?.agent;
    const intent = await this.deriveIntent({
      workspaceId,
      pull,
      repo,
      diff,
      runLog,
      correlationId,
      logger,
      fallback: firstAgent ? { provider: firstAgent.provider, model: firstAgent.model } : undefined,
    });

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent({
          workspaceId,
          pull,
          repo,
          diff,
          agent,
          runId,
          parentLog: runLog,
          intent,
          correlationId,
          logger,
        });
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.raw.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.raw.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /**
   * Derive (or load the cached) PR intent.
   * Fail-open: never throws; a failure is emitted to runLog (Live Log + trace)
   * as well as stdout, and the review proceeds without intent.
   */
  private async deriveIntent(p: DeriveIntentParams): Promise<IntentOutcome> {
    const { workspaceId, pull, repo, diff, runLog, correlationId, logger, fallback } = p;
    // load / resolve_refs are logged exactly once, whatever the outcome.
    let stepsLogged = false;
    try {
      const github = await this.container.github();
      const intentService = new IntentService(this.container, github);
      const featureModel = await resolveFeatureModel(this.container, workspaceId, 'standard');
      const fullModel = `${featureModel.provider}/${featureModel.model}`;

      const intentStartTime = Date.now();
      // Files + hunk headers come from the diff this run loaded (not the pr_files table,
      // which can be empty: see intentFilesFromDiff for the root cause).
      const prFiles = intentFilesFromDiff(diff);
      const fullDiffTokens = Math.ceil((diff.raw?.length ?? 0) / 4);
      const result = await runLog.step(
        'Deriving PR intent',
        () =>
          intentService.deriveIntentDetailed(
            pull,
            { owner: repo.owner, name: repo.name },
            prFiles,
            featureModel.provider,
            featureModel.model,
            {
              fallback,
              reuseIfSameHead: true,
              onLlmCall: ({ provider, model, estPromptTokens }) => {
                runLog.info(
                  `Intent input: ~${estPromptTokens} est. tokens (vs ~${fullDiffTokens} for full diff)`,
                  { step: 'intent.input', correlationId },
                );
                runLog.info(`Intent: calling ${provider}/${model}`, { step: 'intent.call', correlationId });
              },
            },
          ),
        { kind: 'tool' },
      );
      const intentDurationMs = Date.now() - intentStartTime;

      const meta = result.meta;
      // Everything below goes to runLog (Live Log + persisted trace log): the message text
      // carries the data because event `data` is not persisted.
      {
        const reason = result.status === 'failed' ? result.error : undefined;
        runLog.info(loadLine(meta, reason), { step: 'intent.load', cache: meta?.cache, correlationId });
        runLog.info(resolveRefsLine(meta, reason), {
          step: 'intent.resolve_refs',
          statuses: meta?.refStatuses ?? {},
          correlationId,
        });
        stepsLogged = true;
      }
      if (meta) {
        for (const w of meta.warnings) {
          runLog.info(`intent.derive warning: ${w}`, { step: 'intent.derive', correlationId });
          logger?.warn({ prId: pull.id, correlationId, step: 'intent.derive', warning: w }, w);
        }
      }

      if (result.status === 'failed') {
        // RunLogger has no warn level; `error` is the only visible-in-Live-Log kind
        // for a degraded step. The run itself continues.
        runLog.error(`intent.derive failed (continuing without intent): ${result.error}`, {
          step: 'intent.derive',
          model: fullModel,
          durationMs: intentDurationMs,
          correlationId,
          success: false,
        });
        return { status: 'failed', attempts: result.attempts };
      }

      const intent = result.intent;
      const usedModel = meta?.model ?? fullModel;
      const usedProvider = usedModel.split('/')[0];
      const details = meta ? llmDetails(meta) : '';
      const origin =
        result.status === 'cached'
          ? `intent.derive: cache hit (no LLM call), confidence=${intent.confidence}`
          : `intent.derive: derived via LLM, provider=${usedProvider}, model=${usedModel}` +
            (meta?.fallbackFrom ? ` (fell back from ${meta.fallbackFrom})` : '') +
            `, duration=${intentDurationMs}ms, confidence=${intent.confidence}` +
            (details ? `, ${details}` : '');
      runLog.info(origin, {
        step: 'intent.derive',
        model: usedModel,
        durationMs: intentDurationMs,
        confidence: intent.confidence,
        cached: result.status === 'cached',
        tokens: meta?.tokens,
        costUsd: meta?.costUsd,
        correlationId,
        success: true,
      });
      runLog.info(
        result.status === 'cached'
          ? 'Intent reused (head SHA unchanged) — injecting into review prompt'
          : 'Intent derived — injecting into review prompt',
        { step: 'intent.inject', correlationId },
      );
      const policy = reviewIntentPolicy(intent);
      if (policy.line) {
        runLog.info(policy.line, {
          step: intent.confidence === 0 ? 'intent.skip' : 'intent.low_confidence',
          confidence: intent.confidence,
          correlationId,
        });
      }
      return { intent, status: result.status, attempts: result.attempts };
    } catch (err) {
      // Fail-open (setup failure: github client, feature model, file load)
      const errorMsg = (err as Error).message;
      if (!stepsLogged) {
        runLog.info(loadLine(undefined, errorMsg), { step: 'intent.load', correlationId });
        runLog.info(resolveRefsLine(undefined, errorMsg), { step: 'intent.resolve_refs', correlationId });
      }
      runLog.error(`intent.derive failed (continuing without intent): ${errorMsg}`, {
        step: 'intent.derive',
        correlationId,
        success: false,
      });
      logger?.warn(
        { err: errorMsg, prId: pull.id, correlationId, step: 'intent.derive', success: false },
        'Failed to derive intent; continuing without it',
      );
      return { status: 'failed', attempts: 0 };
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(p: RunOneAgentParams): Promise<RunOutcome> {
    const { workspaceId, pull, repo, diff, agent, runId, intent, correlationId, logger } = p;
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = p.parentLog.forRun(runId, { agent: agent.name });

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);

    // Held outside the try so failure/cancel traces keep the resolved entries (AC-60).
    let pc: ResolvedProjectContext | undefined;
    try {
      // (container.llm throws if the provider key is missing — caught below and
      // persisted as a failed run.)
      const llm = await this.resolveProvider(agent, runLog);
      const { callersDigest, repoMap, rankNote } = await this.gatherRepoContext(agent, pull, diff, runLog);
      const task = taskLine(pull) + rankNote;

      // Skills — agent's linked, enabled skills, sorted by agent_skills.order
      // (linkedSkills already sorts ascending). Only enabled skills are
      // injected; a disabled link stays linked but contributes nothing to the
      // prompt (spec §1/§4).
      const linkedSkills = await this.agents.linkedSkills(agent.id);
      const enabledSkills = linkedSkills.filter((l) => l.skill.enabled);
      const skillsMeta = enabledSkills.map((l) => ({
        skill_id: l.skill.id,
        name: l.skill.name,
        tokens: this.container.tokenizer.count(l.skill.body),
      }));

      // Project context (SPEC-02): enabled skills' docs (skill order) then the agent's own.
      // Nothing effective -> no source call and no trace/prompt change (AC-47).
      const docs = effectiveDocs(
        enabledSkills.map((l) => ({ id: l.skill.id, name: l.skill.name, contextPaths: l.skill.contextPaths ?? [] })),
        agent.contextPaths ?? [],
      );
      if (docs.length > 0) {
        pc = await resolveProjectContext({
          // A missing token must not fail the run (AC-49/AC-50): degrade to read_error entries.
          source: await this.container.projectDocs().catch(
            (err: unknown): ProjectDocsSource => ({
              resolveBranchHead: async () => {
                throw err;
              },
              listTree: async () => [],
              readBlob: async () => null,
            }),
          ),
          repo: { owner: repo.owner, name: repo.name },
          branch: repo.defaultBranch,
          effective: docs,
          tokenizer: this.container.tokenizer,
        });
        const skipped = pc.entries.filter((e) => e.status === 'skipped');
        runLog.info(
          projectContextSummaryLine({
            injected: pc.injected.length,
            tokens: pc.injectedTokens,
            skipped: skipped.length,
          }),
        );
        for (const e of skipped) runLog.info(projectContextSkipLine(e.path, e.reason ?? 'unknown'));
      }

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const reviewStartTime = Date.now();
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // Skills feature — enabled, ordered skill bodies (empty array omits the
        // section entirely inside assemblePrompt).
        ...(enabledSkills.length > 0 ? { skills: enabledSkills.map((l) => l.skill.body) } : {}),
        // Project context docs (untrusted; wrapped by reviewer-core). Omitted when none injected.
        ...(pc && pc.injected.length > 0
          ? { projectContext: pc.injected.map((d) => ({ path: d.path, content: d.content })) }
          : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(pull.body ? { prDescription: pull.body } : {}),
        // Structured intent (summary + in/out scope): reviewer-core renders the
        // prompt section and applies the code-owned scope policy. Omitted when
        // not available (fail-open, no scope filtering).
        // Confidence 0 (no description/files/sources): omitted, so no Intent section and no
        // scope instructions. Low confidence: passed, rendered as a weak hint; the scope
        // filter stays inactive below MIN_INTENT_CONFIDENCE (applyScopePolicy).
        ...(reviewIntentPolicy(intent.intent).include ? { intentObj: intent.intent } : {}),
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.container.runBus.isCancelled(runId)) throw new RunCancelledError();
        },
        // Pass injected logger and correlation ID for structured prompt logging
        logger: logger,
        correlationId,
      });

      logRunMetrics(runLog, logger, {
        runId,
        model: agent.model,
        outcome,
        reviewDurationMs: Date.now() - reviewStartTime,
        intent,
        correlationId,
      });

      const { review, findingRows } = await this.persistReview(workspaceId, pull, agent, runId, outcome, runLog);
      await this.finishRun(runId, pull, agent, outcome, start, runLog, skillsMeta, pc);

      return { review, findings: findingRows, grounding: outcome.grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + the log-so-far so the
      // run (and WHY it failed) is visible on the UI after a reload.
      const cancelled = err instanceof RunCancelledError;
      const status = cancelled ? 'cancelled' : 'failed';
      const msg = cancelled ? 'Cancelled by user' : (err as Error).message;
      runLog.error(cancelled ? 'Run cancelled by user' : `Run failed: ${msg}`);
      await this.repo
        .completeAgentRun(runId, {
          status,
          durationMs: Date.now() - start,
          tokensIn: 0,
          tokensOut: 0,
          findingsCount: 0,
          grounding: '0/0 passed',
          error: msg,
        })
        .catch(() => undefined);
      await this.repo
        .saveRunTrace(runId, this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start, pc))
        .catch(() => undefined);
      this.container.runBus.complete(runId);
      throw err;
    }
  }

  /** Resolve the agent's LLM provider (throws if its key is missing). */
  private resolveProvider(agent: AgentRow, runLog: RunLogger) {
    return runLog.step(
      `Resolving ${agent.provider} provider`,
      () => this.container.llm(agent.provider as Provider),
      { kind: 'tool' },
    );
  }

  /**
   * Repo-intel prompt context (callers digest, repo map, rank note). Per-agent
   * toggle (Agent editor): when an agent opts out all enrichment is skipped so its
   * prompt is identical to the repo-intel-off baseline — independent of the global
   * REPO_INTEL_ENABLED flag, which still gates the facade internally. Every part is
   * best-effort: when repo-intel is off / unindexed the facade degrades and the
   * prompt is identical to the pre-T1.3/T3 shape.
   */
  private async gatherRepoContext(
    agent: AgentRow,
    pull: PullRow,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<{ callersDigest?: string; repoMap?: string; rankNote: string }> {
    if (agent.repoIntel === false) {
      runLog.info('Repo intel disabled for this agent — skipping context enrichment');
      return { rankNote: '' };
    }
    const callersDigest = await this.buildCallersDigest(pull.repoId, diff, runLog);
    const repoMap = await this.buildRepoMapDigest(pull.repoId, runLog);
    const rankNote = await this.buildRankNote(pull.repoId, diff, runLog);
    return { callersDigest, repoMap, rankNote };
  }

  /**
   * Persist the review + ALL findings (in/out/signal; the scope column keeps them
   * apart) and mark the commit reviewed so the PR list can tell reviewed /
   * needs-review (head moved) / stale apart.
   */
  private async persistReview(
    workspaceId: string,
    pull: PullRow,
    agent: AgentRow,
    runId: string,
    outcome: ReviewOutcome,
    runLog: RunLogger,
  ) {
    const review = await this.repo.insertReview({
      workspaceId,
      prId: pull.id,
      agentId: agent.id,
      runId,
      kind: 'review',
      verdict: outcome.review.verdict,
      summary: outcome.review.summary,
      score: outcome.review.score,
      model: agent.model,
    });
    const findingRows = await this.repo.insertFindings(review.id, outcome.allFindings);
    runLog.result(
      `Persisted review ${review.id} with ${findingRows.length} finding(s) (${outcome.review.findings.length} in scope)`,
    );
    await this.repo.markReviewed(pull.id, pull.headSha);
    return { review, findingRows };
  }

  /**
   * Stats rollup + observability: agent_runs row + ONE run_traces document, then
   * close the bus. Counts use scope='in' findings only (`outcome.review.findings`):
   * they drive blockers, severity counts and findingsCount.
   */
  private async finishRun(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    outcome: ReviewOutcome,
    start: number,
    runLog: RunLogger,
    skillsMeta: ReadonlyArray<unknown> = [],
    pc?: ResolvedProjectContext,
  ): Promise<void> {
    // reviewer-core already computes costUsd per LLM call (summed across
    // map-reduce chunks, preferring OpenRouter's live billed cost over our
    // own price-book estimate when the provider reports one) — use it
    // directly rather than re-estimating from the totals here.
    const { tokensIn, tokensOut, grounding, costUsd } = outcome;
    const keptFindings = outcome.review.findings;
    const durationMs = Date.now() - start;

    // Deterministic blocker count (severity ≥ the agent's gate) — the signal
    // the timeline colors on, NOT the model's self-reported verdict.
    const blockers = countBlockers(keptFindings, agent.ciFailOn);
    const severityCounts = rollupSeverities(keptFindings);

    // ---- Observability: ONE run_traces document, THEN agent_runs status ---
    // Trace is saved BEFORE the status flip to 'done': callers (including this
    // repo's own tests) poll agent_runs.status to know a run finished and then
    // immediately fetch its trace. Saving the trace first makes "done" mean
    // "trace is readable", not just "reviews row exists".
    const trace: RunTrace = {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: {
        duration_ms: durationMs,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_usd: costUsd,
        findings: keptFindings.length,
        grounding,
      },
      prompt_assembly: {
        ...outcome.assembly,
        skills_meta: skillsMeta.length > 0 ? skillsMeta : null,
        ...(pc && (outcome.projectContext?.length ?? 0) > 0
          ? {
              project_context_blocks: outcome.projectContext.map((b) => ({
                path: b.path,
                tokens: this.container.tokenizer.count(b.text),
                text: b.text,
              })),
            }
          : {}),
      } as RunTrace['prompt_assembly'],
      tool_calls: outcome.chunks.map((c) => ({
        tool: 'review_file',
        args: c.label,
        meta: outcome.mode,
        ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
      })),
      raw_output: outcome.raw,
      memory_pulled: [],
      specs_read: pc ? pc.entries : [],
      ...projectContextSummary(pc),
      // Persisted log = the run's FULL event buffer (incl. shared pre-work:
      // diff load + intent), not just events recorded inside this method.
      log: runLog.logFor(runId),
    };
    runLog.info('Run complete; trace persisted');
    await this.repo.saveRunTrace(runId, trace);
    await this.repo.completeAgentRun(runId, {
      status: 'done',
      durationMs,
      tokensIn,
      tokensOut,
      costUsd,
      findingsCount: keptFindings.length,
      grounding,
      score: outcome.review.score,
      blockers,
      severityCounts,
      error: null,
    });
    this.container.runBus.complete(runId);
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.container.repoIntel.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.container.repoIntel.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch {
      return '';
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: PullRow,
    agent: AgentRow,
    grounding: string,
    durationMs = 0,
    pc?: ResolvedProjectContext,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: { duration_ms: durationMs, tokens_in: 0, tokens_out: 0, cost_usd: null, findings: 0, grounding },
      prompt_assembly: {
        system: agent.systemPrompt,
        skills: null,
        skills_meta: null,
        memory: null,
        specs: null,
        user: '',
      },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: pc ? pc.entries : [],
      ...projectContextSummary(pc),
      log: this.container.runBus.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
