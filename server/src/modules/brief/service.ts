import type { FastifyBaseLogger } from 'fastify';
import type {
  BlastRadius,
  BriefMissingInput,
  Intent,
  IntentSource,
  PrBrief,
  Provider,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { PerKeyCooldown } from '../../platform/cooldown.js';
import type { PullRow } from '../../db/rows.js';
import { withTimeout } from '../../platform/resilience.js';
import { buildBlastRadius } from '../blast/build.js';
import { changedDiffForPr, type DiffLoadResult } from '../blast/files.js';
import { IntentRepository } from '../intent/repository.js';
import {
  RefResolver,
  extractDocPaths,
  extractIssueRef,
  type RefResolverResult,
  type ResolvedSource,
} from '../intent/ref-resolver.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { isSafeRepoPath, normalizeRef } from './paths.js';
import { BriefRepository } from './repository.js';
import { BriefModelOutput, PrBriefStored, type BriefResponse } from './schema.js';
import { PrBrief as PrBriefSchema } from '@devdigest/shared';
import { diffFacts, diffStats, type DiffFact } from './diff-facts.js';
import { buildBriefPrompt, type BriefPromptOptions } from './prompt.js';
import { clampOutput, groundBrief } from './grounding.js';
import { classifyLlmError, logBriefGeneration, type BriefLogMeta, type BriefOutcome } from './log-line.js';
import {
  BRIEF_ADAPTER_TIMEOUT_MS,
  BRIEF_BUDGET_TOKENS,
  BRIEF_LLM_TIMEOUT_MS,
  BRIEF_MAX_RETRIES,
  BRIEF_MISSING_ORDER,
  MAX_BLAST_CALLERS,
} from './constants.js';

/** Fixed user-facing texts: never provider text, prompts or document content. */
export const BRIEF_ERROR_TEXT = {
  input_over_budget: 'The brief input is too large to send to the model',
  store_failed: 'The brief could not be stored',
} as const;

export function providerUnavailableText(provider: string): string {
  return `Risk Brief model (Settings > Models > Risk Brief): ${provider} is not configured`;
}

export type GenerateResult =
  | { status: 'ok'; outcome: 'ok'; brief: PrBriefStored; meta: BriefLogMeta }
  | {
      status: 'failed';
      outcome: Exclude<BriefOutcome, 'ok'>;
      /** Fixed per-outcome message, safe to return to the client. */
      error: string;
      meta: BriefLogMeta;
    };

export type GenerateForPrResult =
  | { kind: 'ok'; brief: BriefResponse }
  | { kind: 'rate_limited'; retryAfter: number }
  | { kind: 'failed'; error: string; retryAfter: number };

export interface BriefServiceOptions {
  /** Reads (PR, repo, stored brief, head SHA); defaults to a BriefRepository on the container db. */
  reads?: Pick<BriefRepository, 'getBrief' | 'getPull' | 'getRepo' | 'getHeadSha'>;
  /** Per-PR admission control; required, and must live as long as the process (not per request). */
  cooldown: PerKeyCooldown;
  intentRepo?: Pick<IntentRepository, 'getIntent'>;
  briefRepo?: Pick<BriefRepository, 'upsertBrief'>;
  changedDiff?: (workspaceId: string, pr: PullRow, log: FastifyBaseLogger) => Promise<DiffLoadResult>;
  resolveModel?: (workspaceId: string) => Promise<{ provider: Provider; model: string }>;
  ground?: typeof groundBrief;
  now?: () => Date;
  promptOpts?: BriefPromptOptions;
}

export interface GenerateArgs {
  workspaceId: string;
  pr: PullRow;
  repo: { owner: string; name: string; id: string };
  log: FastifyBaseLogger;
}

/**
 * What the model saw of the blast map: callers capped at MAX_BLAST_CALLERS overall (same
 * order and de-duplication as the prompt), every changed symbol group kept.
 */
export function trimBlast(blast: BlastRadius): BlastRadius {
  const seen = new Set<string>();
  let kept = 0;
  const downstream = blast.downstream.map((d) => ({
    ...d,
    callers: d.callers.filter((c) => {
      const key = `${c.name}\u0000${c.file}:${c.line}`;
      if (seen.has(key) || kept >= MAX_BLAST_CALLERS) return false;
      seen.add(key);
      kept++;
      return true;
    }),
  }));
  return { changed_symbols: blast.changed_symbols, downstream, summary: blast.summary };
}

/**
 * Sources of the references the resolver could not even try because GitHub is not
 * configured: the same labels the resolver would use, status `error`.
 */
function errorSources(repo: { owner: string; name: string }, title: string, body: string): ResolvedSource[] {
  const out: ResolvedSource[] = [];
  const ref = extractIssueRef(repo, title, body);
  if (ref.number !== undefined) out.push({ label: `Linked issue #${ref.number}`, status: 'error' });
  for (const x of ref.crossRepo) out.push({ label: `Issue ${x} (other repository)`, status: 'unavailable' });
  const doc = extractDocPaths(body)[0];
  if (doc) {
    out.push({ label: `${doc.toLowerCase().includes('spec') ? 'Spec' : 'Plan'} at ${doc}`, status: 'error' });
  }
  return out;
}

/**
 * Generates and stores the PR brief: gathers inputs (all fail-open), builds the prompt, makes
 * exactly ONE structured model call, then clamps, grounds, validates and upserts. Never writes
 * on failure. Never derives Intent (reads the stored row only).
 */
export class BriefService {
  private intentRepo: Pick<IntentRepository, 'getIntent'>;
  private briefRepo: Pick<BriefRepository, 'upsertBrief'>;
  private reads: NonNullable<BriefServiceOptions['reads']>;
  private cooldown: PerKeyCooldown;

  constructor(private container: Container, private opts: BriefServiceOptions) {
    this.reads = opts.reads ?? new BriefRepository(container.db);
    this.cooldown = opts.cooldown;
    this.intentRepo = opts.intentRepo ?? new IntentRepository(container.db);
    this.briefRepo = opts.briefRepo ?? new BriefRepository(container.db);
  }

  private async loadPull(prId: string, workspaceId: string): Promise<PullRow> {
    const pr = await this.reads.getPull(prId);
    if (!pr) throw new NotFoundError('PR not found');
    if (pr.workspaceId !== workspaceId) throw new AppError('forbidden', 'Forbidden', 403);
    return pr;
  }

  /** The stored brief (DB only: no GitHub, git or model call); 404 when absent or unparseable. */
  async get(workspaceId: string, prId: string, log?: FastifyBaseLogger): Promise<BriefResponse> {
    const pr = await this.loadPull(prId, workspaceId);
    const json = await this.reads.getBrief(pr.id);
    if (json === undefined) throw new NotFoundError('Brief not generated for this PR');

    const parsed = PrBriefSchema.safeParse(json);
    if (!parsed.success) {
      log?.warn({ prId: pr.id, step: 'brief' }, 'brief: stored brief failed to parse; treating as absent');
      throw new NotFoundError('Brief not generated for this PR');
    }
    return {
      ...parsed.data,
      pr_id: pr.id,
      stale: parsed.data.meta.generated_from_head_sha !== pr.headSha,
    };
  }

  /**
   * Admission + generation + the single log line. 404 / 403 / missing repo come before any
   * admission, GitHub call, model call or write.
   */
  async generateForPr(
    workspaceId: string,
    prId: string,
    log: FastifyBaseLogger,
  ): Promise<GenerateForPrResult> {
    const pr = await this.loadPull(prId, workspaceId);
    const repo = await this.reads.getRepo(pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const admission = this.cooldown.admit(pr.id);
    if (!admission.ok) {
      log.warn({ prId: pr.id, step: 'brief' }, 'brief: rate limited');
      return { kind: 'rate_limited', retryAfter: admission.retryAfter };
    }

    let result: GenerateResult;
    try {
      result = await this.generate({ workspaceId, pr, repo, log });
    } catch (err) {
      // Unexpected failure (not a model/provider outcome): still exactly one log line.
      logBriefGeneration(log, {
        prId: pr.id,
        outcome: 'provider_error',
        calls: 0,
        truncated: [],
        missing: [],
        error_class: 'Error',
        error_message: 'Unexpected error while generating the brief',
      });
      throw err;
    } finally {
      this.cooldown.release(pr.id);
    }
    logBriefGeneration(log, result.meta);

    if (result.status === 'failed') {
      return { kind: 'failed', error: result.error, retryAfter: this.cooldown.retryAfter(pr.id) };
    }

    // Staleness against the head SHA as it is now (a push may have landed during generation).
    // The brief is already stored, so a failed re-read must not turn into a 500.
    const currentSha = (await this.reads.getHeadSha(pr.id).catch(() => undefined)) ?? pr.headSha;
    return {
      kind: 'ok',
      brief: {
        ...result.brief,
        pr_id: pr.id,
        stale: result.brief.meta.generated_from_head_sha !== currentSha,
      },
    };
  }

  async generate(args: GenerateArgs): Promise<GenerateResult> {
    const { workspaceId, pr, repo, log } = args;
    const now = this.opts.now ?? (() => new Date());
    const base = { prId: pr.id, truncated: [] as BriefLogMeta["truncated"], missing: [] as BriefMissingInput[] };

    // Model: the Risk Brief setting; no fallback to any other model or provider.
    const choice = await (this.opts.resolveModel
      ? this.opts.resolveModel(workspaceId)
      : resolveFeatureModel(this.container, workspaceId, 'risk_brief'));
    const { provider, model } = choice;

    let llm;
    try {
      llm = await this.container.llm(provider);
    } catch {
      return {
        status: 'failed',
        outcome: 'provider_unavailable',
        error: providerUnavailableText(provider),
        meta: {
          ...base,
          outcome: 'provider_unavailable',
          calls: 0,
          provider,
          model,
          error_class: 'ConfigError',
          error_message: 'The configured provider is not available',
        },
      };
    }

    const missing = new Set<BriefMissingInput>();

    // Intent: read-only. No row or an empty summary means missing.
    let intent: Intent | null = null;
    try {
      const row = await this.intentRepo.getIntent(pr.id);
      if (row?.summary) {
        intent = {
          summary: row.summary,
          in_scope: row.inScope,
          out_of_scope: row.outOfScope,
          confidence: row.confidence,
          sources: row.sources,
          missing_context: row.missingContext,
        };
      }
    } catch (err) {
      log.warn({ prId: pr.id, err: (err as Error).message, step: 'brief' }, 'brief: intent read failed');
    }
    if (!intent) missing.add('intent');

    // Diff: only the facts leave this block (never the raw diff).
    const diff = await (this.opts.changedDiff
      ? this.opts.changedDiff(workspaceId, pr, log)
      : changedDiffForPr(this.container, workspaceId, pr, log));
    let facts: DiffFact[] = [];
    let changedPaths: string[] = [];
    if (diff.status === 'loaded') {
      facts = diffFacts(diff.diff.files);
      // Normalized and safe-filtered once: the same hygiene as the facts and the callers below.
      changedPaths = diff.diff.files.map((f) => normalizeRef(f.path)).filter(isSafeRepoPath);
    } else {
      missing.add('diff');
    }
    const stats = diff.status === 'loaded' ? diffStats(facts) : null;

    // Blast radius.
    let blastFull: BlastRadius | null = null;
    let blastDegradedReason: string | null = null;
    if (diff.status !== 'loaded') blastDegradedReason = 'diff_unavailable';
    else if (changedPaths.length === 0) blastDegradedReason = 'no_changed_files';
    if (changedPaths.length > 0) {
      try {
        const built = buildBlastRadius(await this.container.repoIntel.getBlastRadius(repo.id, changedPaths));
        if (built.degraded) blastDegradedReason = built.reason ?? 'degraded';
        if (!(built.degraded && built.changed_symbols.length === 0)) {
          // Caller paths are normalized and safe-filtered once; the prompt, the stored
          // snapshot and the grounding allow-list all use this same list.
          blastFull = {
            changed_symbols: built.changed_symbols,
            downstream: built.downstream.map((d) => ({
              ...d,
              callers: d.callers.flatMap((c) => {
                const file = normalizeRef(c.file);
                return isSafeRepoPath(file) ? [{ ...c, file }] : [];
              }),
            })),
            summary: built.summary,
          };
        }
      } catch (err) {
        log.warn({ prId: pr.id, err: (err as Error).message, step: 'brief' }, 'brief: blast read failed');
      }
    }
    if (!blastFull) missing.add('blast');
    const blastSnapshot = blastFull ? trimBlast(blastFull) : null;

    // References (linked issue, plan/spec doc). Fail-open: errors become source statuses.
    const body = pr.body ?? '';
    let refs: RefResolverResult = { sourceStatuses: {}, sources: [] };
    try {
      const github = await this.container.github();
      refs = await new RefResolver(github).resolveRefs(
        { owner: repo.owner, name: repo.name },
        pr.title,
        body,
        pr.headSha,
      );
    } catch {
      const sources = errorSources(repo, pr.title, body);
      refs = { sourceStatuses: {}, sources };
    }
    if (body.trim() === '') missing.add('description');
    if (!refs.linkedIssue) missing.add('linked_issue');
    const doc = refs.specDoc
      ? { label: `Spec at ${refs.specDoc.path}`, text: refs.specDoc.content }
      : refs.planDoc
        ? { label: `Plan at ${refs.planDoc.path}`, text: refs.planDoc.content }
        : null;
    if (!doc) missing.add('specs');

    // Code-owned sources: labels and statuses only.
    const sources: IntentSource[] = [
      { label: 'PR title', status: pr.title.trim() ? 'fetched' : 'unavailable' },
      { label: 'PR body', status: body.trim() ? 'fetched' : 'unavailable' },
      { label: 'Changed files', status: facts.length > 0 ? 'fetched' : 'unavailable' },
      ...refs.sources.map((s) => ({ label: s.label, status: s.status })),
    ];

    const missingList = BRIEF_MISSING_ORDER.filter((m) => missing.has(m));
    const prompt = buildBriefPrompt(
      {
        title: pr.title,
        description: body.trim() === '' ? null : body,
        intent,
        blast: blastFull,
        specDoc: doc,
        linkedIssue: refs.linkedIssue
          ? { title: refs.linkedIssue.title, body: refs.linkedIssue.body }
          : null,
        facts,
        missing: missingList,
      },
      this.opts.promptOpts,
    );
    const common = { prId: pr.id, provider, model, missing: missingList };
    if (!prompt.ok) {
      return {
        status: 'failed',
        outcome: 'input_over_budget',
        error: BRIEF_ERROR_TEXT.input_over_budget,
        meta: {
          ...common,
          outcome: 'input_over_budget',
          calls: 0,
          estInputTokens: prompt.estimatedTokens,
          truncated: [],
          error_class: null,
          error_message: BRIEF_ERROR_TEXT.input_over_budget,
        },
      };
    }

    // Exactly one model call.
    let result;
    try {
      result = await withTimeout(
        llm.completeStructured({
          model,
          schema: BriefModelOutput,
          schemaName: 'PrBriefOutput',
          messages: prompt.messages,
          temperature: 0,
          maxRetries: BRIEF_MAX_RETRIES,
          timeoutMs: BRIEF_ADAPTER_TIMEOUT_MS,
        }),
        BRIEF_LLM_TIMEOUT_MS,
      );
    } catch (err) {
      const c = classifyLlmError(err);
      return {
        status: 'failed',
        outcome: c.outcome,
        error:
          c.outcome === 'provider_unavailable' ? providerUnavailableText(provider) : c.error_message,
        meta: {
          ...common,
          outcome: c.outcome,
          calls: 1,
          // A schema failure used every allowed attempt; other failures do not report one.
          schemaAttempts: c.outcome === 'invalid_output' ? BRIEF_MAX_RETRIES + 1 : null,
          estInputTokens: prompt.estimatedTokens,
          truncated: prompt.truncated,
          error_class: c.error_class,
          error_message: c.error_message,
        },
      };
    }

    const attempts = Math.max(1, result.attempts ?? 1);
    const tokensIn = result.tokensIn > 0 ? result.tokensIn : null;
    const tokensOut = result.tokensOut > 0 ? result.tokensOut : null;
    const costUsd = result.costUsd ?? null;
    const okMeta = {
      ...common,
      calls: 1 as const,
      schemaAttempts: attempts,
      estInputTokens: prompt.estimatedTokens,
      tokensIn,
      tokensOut,
      costUsd,
      truncated: prompt.truncated,
    };

    const ground = this.opts.ground ?? groundBrief;
    const clamped = clampOutput(result.data);
    const grounded = ground(clamped, {
      diff: new Map(facts.map((f) => [f.path, f])),
      blastFiles: new Set((blastFull?.downstream ?? []).flatMap((d) => d.callers.map((c) => c.file))),
    });

    const candidate: PrBrief = {
      summary: clamped.summary,
      intent,
      blast: blastSnapshot,
      risks: { risks: grounded.risks },
      review_focus: grounded.review_focus,
      meta: {
        generated_from_head_sha: pr.headSha,
        generated_at: now().toISOString(),
        provider,
        model,
        schema_attempts: attempts,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        cost_usd: costUsd,
        missing: missingList,
        sources,
        diff_stats: stats,
        input: {
          estimated_tokens: prompt.estimatedTokens,
          budget_tokens: this.opts.promptOpts?.budgetTokens ?? BRIEF_BUDGET_TOKENS,
          truncated: prompt.truncated,
          blast_degraded_reason: blastDegradedReason,
        },
        grounding: grounded.counts,
      },
    };

    const parsed = PrBriefStored.safeParse(candidate);
    if (!parsed.success) {
      return {
        status: 'failed',
        outcome: 'invalid_output',
        error: 'The model returned output that failed validation',
        meta: {
          ...okMeta,
          outcome: 'invalid_output',
          grounding: grounded.counts,
          error_class: 'ValidationError',
          error_message: 'The composed brief failed validation',
        },
      };
    }

    try {
      await this.briefRepo.upsertBrief(pr.id, parsed.data);
    } catch (err) {
      log.error({ prId: pr.id, err: (err as Error).message, step: 'brief' }, 'brief: store failed');
      return {
        status: 'failed',
        outcome: 'provider_error',
        error: BRIEF_ERROR_TEXT.store_failed,
        meta: {
          ...okMeta,
          outcome: 'provider_error',
          grounding: grounded.counts,
          error_class: 'Error',
          error_message: BRIEF_ERROR_TEXT.store_failed,
        },
      };
    }

    return {
      status: 'ok',
      outcome: 'ok',
      brief: parsed.data,
      meta: { ...okMeta, outcome: 'ok', grounding: grounded.counts },
    };
  }
}
