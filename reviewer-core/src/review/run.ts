import type {
  Finding,
  LLMProvider,
  PromptAssembly,
  Review,
  RunEventKind,
  UnifiedDiff,
  Intent,
} from '@devdigest/shared';
import { ModelReviewSchema, type ModelReviewOut } from './output-schema.js';
import { assemblePrompt, type ProjectContextDoc } from '../prompt.js';
import { groundFindings, groundingSummary } from '../grounding.js';
import { reduceReviews, scoreFromFindings, sliceDiff } from './reduce.js';
import type { Logger } from '../logging/prompt-logger.js';
import { applyScopePolicy, deriveScopedVerdict, formatScopeStats, type ScopeStats } from './scope.js';
import { changedLines } from './changed-lines.js';

/**
 * reviewPullRequest — the review engine entry point.
 *
 * given (diff + resolved agent inputs + injected LLM) → grounded Review.
 *
 * This is the pure core lifted out of the server's `ReviewService.runOneAgent`:
 * assemble prompt → single-pass OR map-reduce per file → reduce → SHARED
 * citation-grounding gate. It performs NO I/O beyond the injected LLM provider
 * (no DB, GitHub, fs, memory retrieval, intent, or persistence) — those stay in
 * the caller (server persists + streams SSE; runner posts + writes an artifact).
 *
 * Skill bodies / memory / specs are RESOLVED strings here: the caller turns
 * AgentManifest skill slugs into bodies (DB in the studio, fs in the runner).
 */

/** Default map-reduce threshold (matches the server's FILE_MAP_THRESHOLD_LINES). */
export const DEFAULT_MAP_THRESHOLD_LINES = 400;
/** Default structured-output reprompt retries (matches REVIEW_MAX_RETRIES). */
export const DEFAULT_REVIEW_MAX_RETRIES = 2;

export type ReviewStrategy = 'auto' | 'single-pass' | 'map-reduce';
export type ReviewMode = 'single-pass' | 'map-reduce';

/** Progress event emitted during a review (server → SSE bus, runner → log). */
export interface ReviewEvent {
  kind: RunEventKind;
  msg: string;
  data?: unknown;
}

export interface ReviewInput {
  /** Agent system prompt (trusted). */
  systemPrompt: string;
  /** Model id understood by the injected provider (e.g. 'deepseek/deepseek-v4-flash'). */
  model: string;
  /** The PR's unified diff (already parsed; hunks carry new-side line numbers). */
  diff: UnifiedDiff;
  /** Injected LLM provider (OpenRouter in CI, OpenAI/Anthropic in the studio). */
  llm: LLMProvider;
  /** 'auto' (default) picks single-pass unless the diff is large + multi-file. */
  strategy?: ReviewStrategy;
  /** Resolved skill bodies (NOT slugs). */
  skills?: string[];
  /** Curated memory items. */
  memory?: string[];
  /** Project-context spec chunks (untrusted; delimiter-wrapped downstream). */
  specs?: string[];
  /**
   * Project-context documents (SPEC-02), in effective order. Untrusted. Injected
   * whole (never summarised) as `## Project context` in EVERY chunk call. Policy
   * (scope/grounding/verdict) never reads them. Empty/undefined → section omitted.
   */
  projectContext?: ProjectContextDoc[];
  /**
   * Optional callers-of-changed-symbols digest (T1.3). Untrusted; rendered
   * before the diff section. Empty/undefined → section omitted.
   */
  callers?: string;
  /**
   * Optional repo skeleton / map (T3). Untrusted; rendered before the project
   * context section. Empty/undefined → section omitted.
   */
  repoMap?: string;
  /** PR author's description/body (untrusted; truncated + delimiter-wrapped in
      the prompt). Empty/undefined → section omitted. */
  prDescription?: string;
  /**
   * Optional derived intent (summary, in/out scope, confidence). Untrusted
   * (derived from PR title/body/issue/specs). Rendered after PR description.
   * Empty/undefined → section omitted.
   */
  intent?: string;
  /**
   * Optional derived intent object (structured). Drives the code-owned scope
   * policy (applyScopePolicy). Omitted/low-confidence → filter inactive.
   */
  intentObj?: Intent;
  /** Task framing line, e.g. "Review PR #482 …". */
  task?: string;
  /** Override the structured-output retry budget. */
  maxRetries?: number;
  /** Override the map-reduce line threshold. */
  mapThresholdLines?: number;
  /**
   * OpenRouter session id — forwarded on every LLM call so all chunks of this
   * review group into one session in the OpenRouter dashboard.
   */
  sessionId?: string;
  /** Progress sink. */
  onEvent?: (e: ReviewEvent) => void;
  /**
   * Cancellation checkpoint, called before each (expensive) chunk LLM call.
   * Supply a function that THROWS to abort mid-run (the caller owns the error
   * type, e.g. the server's RunCancelledError); the engine stays agnostic.
   */
  checkCancelled?: () => void;
  /** Optional injected logger for structured prompt assembly logging (pino-like). */
  logger?: Logger;
  /** Optional correlation ID for tracing prompt assembly across logs. */
  correlationId?: string;
}

export interface ReviewOutcome {
  /**
   * The reduced, GROUNDED review. `review.findings` = scope 'in' findings ONLY
   * (what drives score, verdict and counters); out/signal are NOT here.
   */
  review: Review;
  /** Human-readable grounding summary, e.g. "3/4 passed". */
  grounding: string;
  /** Findings dropped by grounding, with reasons (for logs / "never go silent"). */
  dropped: { finding: Finding; reason: string }[];
  /** Which path ran. */
  mode: ReviewMode;
  /** Prompt assembly (for the run trace). Single-pass: the one call; map-reduce: the whole-diff assembly. */
  assembly: PromptAssembly;
  /** Project-context blocks exactly as sent (last assembly); [] when none. */
  projectContext: { path: string; text: string }[];
  /** Per-chunk labels (for the run trace's tool_calls). */
  chunks: { label: string }[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  /** Joined raw model outputs (for the run trace). */
  raw: string;
  /** EVERY grounded finding annotated in/out/signal (incl. the signal): persist THIS, not review.findings. */
  allFindings: Finding[];
  /** Scope policy counters (single source, incl. `overridesTotal`). */
  scope: ScopeStats;
  /** Structured LLM calls made, summed over attempts (reprompts included). */
  llmCalls: number;
}

function selectMode(strategy: ReviewStrategy, diff: UnifiedDiff, threshold: number): ReviewMode {
  if (strategy === 'single-pass') return 'single-pass';
  if (strategy === 'map-reduce') return diff.files.length > 1 ? 'map-reduce' : 'single-pass';
  // auto: map-reduce only when the diff is both large AND multi-file (else 1 call).
  const totalLines = diff.files.reduce((n, f) => n + f.additions + f.deletions, 0);
  return totalLines > threshold && diff.files.length > 1 ? 'map-reduce' : 'single-pass';
}

export async function reviewPullRequest(input: ReviewInput): Promise<ReviewOutcome> {
  const threshold = input.mapThresholdLines ?? DEFAULT_MAP_THRESHOLD_LINES;
  const maxRetries = input.maxRetries ?? DEFAULT_REVIEW_MAX_RETRIES;
  const mode = selectMode(input.strategy ?? 'auto', input.diff, threshold);
  const emit = (kind: RunEventKind, msg: string, data?: unknown) =>
    input.onEvent?.({ kind, msg, data });

  const promptParts = {
    system: input.systemPrompt,
    skills: input.skills,
    memory: input.memory,
    specs: input.specs,
    projectContext: input.projectContext,
    callers: input.callers,
    repoMap: input.repoMap,
    prDescription: input.prDescription,
    intent: input.intent,
    intentObj: input.intentObj,
    task: input.task,
  };

  // Whole-diff assembly is the trace default; overwritten below for single-pass.
  const whole = assemblePrompt(
    { ...promptParts, diff: input.diff.raw },
    input.logger,
    input.model,
    input.correlationId,
  );
  let assembly: PromptAssembly = whole.assembly;
  let projectContext = whole.projectContext;

  const chunks =
    mode === 'map-reduce'
      ? input.diff.files.map((f) => ({ label: f.path, diffText: sliceDiff(input.diff, f.path) }))
      : [{ label: 'all files', diffText: input.diff.raw }];

  emit(
    'info',
    mode === 'map-reduce'
      ? `Large diff → map-reduce over ${input.diff.files.length} files`
      : `Reviewing ${input.diff.files.length} changed file(s) in one pass`,
  );

  const partials: Review[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd: number | null = 0;
  const raws: string[] = [];
  let llmCalls = 0;

  for (const chunk of chunks) {
    // Cancellation checkpoint — stop before the next (expensive) LLM call.
    input.checkCancelled?.();
    // 'map:' prefix only for the map-reduce path (one call per file). In
    // single-pass there is exactly one chunk (the whole diff) — don't mislabel it.
    emit(
      'tool',
      mode === 'map-reduce' ? `map: reviewing ${chunk.label}` : `Reviewing ${chunk.label} in one pass`,
      { file: chunk.label },
    );
    const a = assemblePrompt(
      { ...promptParts, diff: chunk.diffText },
      input.logger,
      input.model,
      input.correlationId,
    );
    if (mode === 'single-pass') assembly = a.assembly;
    projectContext = a.projectContext;
    const res = await input.llm.completeStructured<ModelReviewOut>({
      model: input.model,
      schema: ModelReviewSchema,
      schemaName: 'Review',
      messages: a.messages,
      maxRetries,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    tokensIn += res.tokensIn;
    tokensOut += res.tokensOut;
    costUsd = costUsd == null || res.costUsd == null ? null : costUsd + res.costUsd;
    raws.push(res.raw);
    llmCalls += res.attempts ?? 1;
    partials.push(res.data);
    emit('result', `${chunk.label}: ${res.data.findings.length} candidate finding(s)`);
  }

  const merged = reduceReviews(partials);
  emit(
    'result',
    `Reduced to ${merged.findings.length} finding(s); verdict=${merged.verdict}, score=${merged.score}`,
  );

  // SHARED citation-grounding gate (the only post-step; not duplicated per strategy).
  const ground = groundFindings(merged.findings, input.diff);
  const grounding = groundingSummary(ground);
  for (const d of ground.dropped) {
    emit('info', `grounding dropped "${d.finding.title}": ${d.reason}`);
  }
  emit('result', `Citation grounding: ${grounding}`);

  // Code-owned scope policy: ONCE over ALL grounded findings (never per chunk).
  const scoped = applyScopePolicy(ground.kept, {
    intent: input.intentObj,
    changedLines: changedLines(input.diff),
  });
  const st = scoped.stats;
  emit('result', formatScopeStats(st));
  for (const o of scoped.overrideLog) {
    emit('info', `scope override "${o.title}": model=out -> in (${o.reason})`);
  }

  // Score + verdict come from scope=in findings ONLY (see deriveScopedVerdict).
  const finalFindings = scoped.visible;
  const verdict = deriveScopedVerdict(merged.verdict, scoped);

  // Score is derived from the findings that SURVIVED grounding+scope (not the model's
  // self-reported number) so the score, the findings list, and the deterministic
  // event always agree.
  return {
    review: { ...merged, verdict, findings: finalFindings, score: scoreFromFindings(finalFindings) },
    grounding,
    dropped: ground.dropped,
    mode,
    assembly,
    projectContext,
    chunks: chunks.map((c) => ({ label: c.label })),
    tokensIn,
    tokensOut,
    costUsd,
    raw: raws.join('\n---\n'),
    allFindings: scoped.all,
    scope: st,
    llmCalls,
  };
}
