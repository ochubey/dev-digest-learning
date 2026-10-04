import type { Container } from '../../platform/container.js';
import type { Intent, IntentSource, GitHubClient, Provider } from '@devdigest/shared';
import { Intent as IntentSchema } from '../../vendor/shared/contracts/brief.js';
import type { PullRow } from '../../db/rows.js';
import type { IntentRepository } from './repository.js';
import { RefResolver, type ResolvedSource, type SourceStatus } from './ref-resolver.js';
import { IntentRepository as IntentRepo } from './repository.js';
import { groundOutOfScope } from './scope-grounding.js';
import { applyConfidenceCaps } from './confidence.js';
import { assembleIntentPrompt, type IntentPromptStats } from '@devdigest/reviewer-core';
import { createHash } from 'node:crypto';

/** Prompt cap in reviewer-core (`MAX_FILES` in intent/prompt-builder.ts): files beyond it are dropped. */
const PROMPT_FILE_CAP = 100;

/**
 * Observability details of one derive attempt. Surfaced to callers (run-executor / routes)
 * which write them to runLog; the service itself stays free of logging sinks.
 */
export interface DeriveMeta {
  /** `hit` = served from cache; `miss` = derived; `bypass` = derived because `force` skipped the cache. */
  cache: 'hit' | 'miss' | 'bypass' | 'not_reached';
  /** True when an existing intent was reused as is (`reuseIfSameHead`): no refs fetched, no LLM call. */
  reused?: boolean;
  /** False when the failure happened before references were resolved (default: reached). */
  refsReached?: boolean;
  /** `provider/model` actually used for the LLM call (derived only; differs from the requested one on fallback). */
  model?: string;
  /** The feature model that was requested but unavailable, when a fallback was used. */
  fallbackFrom?: string;
  tokensIn?: number;
  tokensOut?: number;
  tokens?: number;
  /** Provider-reported/estimated cost; null when unknown. */
  costUsd?: number | null;
  /** Rough prompt size (chars / 4), before the call. */
  estPromptTokens?: number;
  prompt?: IntentPromptStats;
  /** Per referenced source: fetched | unavailable | error (code-owned, from RefResolver). */
  refStatuses: Record<string, SourceStatus>;
  /** Labelled referenced sources (issue / plan / spec) with their statuses, in resolution order. */
  refSources: ResolvedSource[];
  /** The persisted `sources` (code-owned statuses). */
  sources: IntentSource[];
  warnings: string[];
}

/**
 * Outcome of a derive attempt; lets callers surface fail-open errors and cache hits.
 * `attempts` = structured LLM attempts actually made (reprompts included): 0 for a
 * cache hit or a failure before the call completed.
 */
export type DeriveIntentResult =
  | { status: 'cached'; intent: Intent; attempts: number; meta?: DeriveMeta }
  | { status: 'derived'; intent: Intent; attempts: number; meta?: DeriveMeta }
  | { status: 'failed'; intent?: undefined; error: string; attempts: number; meta?: DeriveMeta };

export interface DeriveOptions {
  /** Skip the cache and always call the LLM (manual re-derive). */
  force?: boolean;
  /**
   * Reuse the persisted intent when it was derived from the PR's CURRENT head SHA: no ref
   * fetch, no LLM call. A new head SHA (or no intent yet) derives normally. Review runs set
   * this; only the manual Regenerate button (`force`) bypasses it. Ignored when `force` is set.
   */
  reuseIfSameHead?: boolean;
  /** Called right before the LLM call (never on a cache hit / reuse): lets callers log the input size and model. */
  onLlmCall?: (info: { provider: Provider; model: string; estPromptTokens: number }) => void;
  /** Main review model, used (with a warning) when the feature model's provider is unavailable. */
  fallback?: { provider: Provider; model: string };
}

/** Cache key over everything the intent depends on besides the head SHA. */
export function computeCacheKeyHash(
  title: string,
  body: string,
  linkedIssueTitle?: string,
  linkedIssueBody?: string,
  planDocContent?: string,
  specDocContent?: string,
): string {
  const combined = [
    title,
    body,
    linkedIssueTitle || '',
    linkedIssueBody || '',
    planDocContent || '',
    specDocContent || '',
  ].join('\n|||SEP|||\n');
  return createHash('sha256').update(combined).digest('hex');
}

export class IntentService {
  private refResolver: RefResolver;
  private repo: IntentRepository;

  constructor(private container: Container, private github: GitHubClient) {
    this.refResolver = new RefResolver(github);
    this.repo = new IntentRepo(container.db);
  }

  /**
   * Derive intent for a PR, or return cached intent if head SHA and metadata hash match.
   * Fail-open: on error, logs and marks intent as unavailable.
   */
  async deriveIntent(
    pull: PullRow,
    repo: { owner: string; name: string },
    prFiles: Array<{ patch?: string | null; path: string }>,
    provider: Provider,
    model: string,
    opts: DeriveOptions = {},
  ): Promise<Intent | undefined> {
    return (await this.deriveIntentDetailed(pull, repo, prFiles, provider, model, opts)).intent;
  }

  /** Same as `deriveIntent` (fail-open, never throws) but reports cache hit vs derive vs error. */
  async deriveIntentDetailed(
    pull: PullRow,
    repo: { owner: string; name: string },
    prFiles: Array<{ patch?: string | null; path: string }>,
    provider: Provider,
    model: string,
    opts: DeriveOptions = {},
  ): Promise<DeriveIntentResult> {
    let attempts = 0;
    // Progress markers so a failure still reports how far the derive got (load / refs / LLM).
    let cacheChecked = false;
    let llmCalled = false;
    const warnings: string[] = [];
    let partial: Pick<DeriveMeta, 'refStatuses' | 'refSources' | 'sources'> | undefined;
    try {
      if (opts.reuseIfSameHead && !opts.force) {
        const existing = await this.repo.getIntent(pull.id);
        if (existing?.summary && existing.derivedFromHeadSha === pull.headSha) {
          return {
            status: 'cached',
            attempts: 0,
            intent: {
              summary: existing.summary,
              in_scope: existing.inScope,
              out_of_scope: existing.outOfScope,
              confidence: existing.confidence,
              sources: existing.sources,
              missing_context: existing.missingContext,
            },
            meta: { cache: 'hit', reused: true, refStatuses: {}, refSources: [], sources: existing.sources, warnings },
          };
        }
      }
      const body = pull.body || '';
      // The cache key covers the linked issue / docs content, so refs are fetched before the
      // cache check (an edited issue must invalidate the cache even without a new commit).
      const refs = await this.refResolver.resolveRefs(repo, pull.title, body, pull.headSha);
      const sources = this.buildSources(pull.title, body, prFiles.length, refs.sources);
      partial = { refStatuses: refs.sourceStatuses, refSources: refs.sources, sources };

      if (prFiles.length >= PROMPT_FILE_CAP) {
        warnings.push(
          `PR has ${prFiles.length} files (>= ${PROMPT_FILE_CAP}): only the first ${PROMPT_FILE_CAP} are sent to the intent prompt`,
        );
      }

      const cacheKeyHash = computeCacheKeyHash(
        pull.title,
        body,
        refs.linkedIssue?.title,
        refs.linkedIssue?.body,
        refs.planDoc?.content,
        refs.specDoc?.content,
      );

      // Check if we have a cached intent with matching SHA and metadata hash
      const cached = await this.repo.getIntent(pull.id);
      cacheChecked = true;
      if (
        !opts.force &&
        cached &&
        cached.derivedFromHeadSha === pull.headSha &&
        cached.cacheKeyHash === cacheKeyHash &&
        cached.summary
      ) {
        return {
          status: 'cached',
          attempts: 0,
          intent: {
            summary: cached.summary,
            in_scope: cached.inScope,
            out_of_scope: cached.outOfScope,
            confidence: cached.confidence,
            sources: cached.sources,
            missing_context: cached.missingContext,
          },
          meta: { cache: 'hit', ...partial, sources: cached.sources, warnings },
        };
      }

      // Get the LLM provider; fall back to the main review model (with a warning) if the
      // feature model's provider cannot be set up (missing key, unavailable, ...).
      let usedProvider = provider;
      let usedModel = model;
      let fallbackFrom: string | undefined;
      let llm;
      try {
        llm = await this.container.llm(provider);
      } catch (err) {
        const fb = opts.fallback;
        if (!fb || (fb.provider === provider && fb.model === model)) throw err;
        const reason = err instanceof Error ? err.message : String(err);
        fallbackFrom = `${provider}/${model}`;
        warnings.push(
          `standard (feature) model ${provider}/${model} unavailable (${reason}); falling back to main review model ${fb.provider}/${fb.model}`,
        );
        llm = await this.container.llm(fb.provider);
        usedProvider = fb.provider;
        usedModel = fb.model;
      }

      // Build the prompt and call the LLM
      const prompt = assembleIntentPrompt({
        title: pull.title,
        body,
        linkedIssueTitle: refs.linkedIssue?.title,
        linkedIssueBody: refs.linkedIssue?.body,
        planDocPath: refs.planDoc?.path,
        planDocContent: refs.planDoc?.content,
        specDocPath: refs.specDoc?.path,
        specDocContent: refs.specDoc?.content,
        files: prFiles.map((f) => ({ path: f.path, patch: f.patch ?? undefined })),
        unavailableRefs: refs.sources
          .filter((x) => x.status !== 'fetched')
          .map((x) => ({ label: x.label, status: x.status as 'unavailable' | 'error' })),
      });

      llmCalled = true;
      opts.onLlmCall?.({
        provider: usedProvider,
        model: usedModel,
        estPromptTokens: Math.ceil(prompt.stats.promptChars / 4),
      });
      const result = await llm.completeStructured<Intent>({
        model: usedModel,
        schema: IntentSchema,
        schemaName: 'Intent',
        messages: prompt.messages,
        temperature: 0,
      });

      attempts = result.attempts ?? 1;

      // Confidence is min(model, ceiling); the ceiling is computed in code from evidence
      // (empty description, unavailable explicit sources). See confidence.ts.
      const capped = applyConfidenceCaps({
        modelConfidence: result.data.confidence,
        bodyEmpty: body.trim().length === 0,
        statuses: refs.sourceStatuses,
        anyFetched: refs.sources.some((x) => x.status === 'fetched'),
      });
      const confidence = capped.confidence;
      warnings.push(...capped.reasons);

      // out_of_scope must be grounded in the PR text (guards against the model echoing example
      // values or inventing exclusions); ungrounded items are dropped and reported as a warning.
      const scopeEvidence = [
        pull.title,
        body,
        refs.linkedIssue?.title,
        refs.linkedIssue?.body,
        refs.planDoc?.content,
        refs.specDoc?.content,
        ...prFiles.map((f) => f.path),
      ]
        .filter(Boolean)
        .join('\n');
      const outScope = groundOutOfScope(result.data.out_of_scope, scopeEvidence);
      if (outScope.dropped.length > 0) {
        warnings.push(
          `dropped ${outScope.dropped.length} out_of_scope item(s) not grounded in the PR title, body, issue, plan or file paths`,
        );
      }

      // Statuses are code-owned: the LLM's own `sources` (labels AND statuses) are not trusted.
      const intent: Intent = {
        summary: result.data.summary,
        in_scope: result.data.in_scope,
        out_of_scope: outScope.kept,
        confidence,
        sources,
        missing_context: result.data.missing_context || [],
      };

      // Persist the intent with cache key hash
      const fullModel = `${usedProvider}/${usedModel}`;
      const tokens = result.tokensIn + result.tokensOut;
      await this.repo.upsertIntent(pull.id, {
        ...intent,
        derivedFromHeadSha: pull.headSha,
        cacheKeyHash,
        model: fullModel,
        tokens,
        costUsd: result.costUsd ?? 0,
        basis: body.trim().length === 0 ? 'files_only' : 'title_body',
      });

      return {
        status: 'derived',
        intent,
        attempts,
        meta: {
          cache: opts.force ? 'bypass' : 'miss',
          model: fullModel,
          fallbackFrom,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          tokens,
          costUsd: result.costUsd ?? null,
          estPromptTokens: Math.ceil(prompt.stats.promptChars / 4),
          prompt: prompt.stats,
          ...partial,
          warnings,
        },
      };
    } catch (err) {
      // Fail-open: log explicit error and continue without intent
      const error = err instanceof Error ? err.message : String(err);
      console.error(`Failed to derive intent for PR ${pull.id}: ${error}`);
      // The call was made but errored (the provider error does not report its attempt count):
      // report one attempt as a lower bound; 0 means no call was made.
      const failedAttempts = llmCalled ? Math.max(1, attempts) : attempts;
      // Always report how far the derive got, so load / resolve_refs can be logged honestly.
      const meta: DeriveMeta = {
        cache: cacheChecked ? (opts.force ? 'bypass' : 'miss') : 'not_reached',
        refsReached: partial !== undefined,
        refStatuses: {},
        refSources: [],
        sources: [],
        ...partial,
        warnings,
      };
      return { status: 'failed', error, attempts: failedAttempts, meta };
    }
  }

  /** Code-owned `sources`: what the PR itself provided + what the resolver tried to read. */
  private buildSources(
    title: string,
    body: string,
    fileCount: number,
    resolved: ResolvedSource[],
  ): IntentSource[] {
    return [
      { label: 'PR title', status: title.trim() ? 'fetched' : 'unavailable' },
      { label: 'PR body', status: body.trim() ? 'fetched' : 'unavailable' },
      { label: 'Changed files', status: fileCount > 0 ? 'fetched' : 'unavailable' },
      ...resolved,
    ];
  }
}
