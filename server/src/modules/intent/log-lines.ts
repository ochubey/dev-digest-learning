import type { Intent } from '@devdigest/shared';
import { MIN_INTENT_CONFIDENCE } from '@devdigest/reviewer-core';
import type { DeriveMeta } from './service.js';

/**
 * Human-readable run-log text for the intent step. runLog event `data` is not persisted
 * with the run, so everything worth seeing in the Live Log is carried in the message text.
 * Counts and statuses only: never PR bodies, issue text or prompts.
 */

const STATUS_WORD = { fetched: 'found', unavailable: 'not_found', error: 'error' } as const;

/** Single-line, ASCII-only text (run-log lines must not carry Unicode punctuation or newlines). */
export function asciiSafe(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[^ -~]/g, '?').trim();
}

/**
 * `intent.load: cache hit|miss|bypass`, or `not reached (<reason>)` when the derive failed
 * before the cache was checked (or there is no meta at all). Logged regardless of outcome.
 */
export function loadLine(meta?: DeriveMeta, reason?: string): string {
  if (!meta || meta.cache === 'not_reached') {
    return `intent.load: not reached (${asciiSafe(reason ?? 'unknown')})`;
  }
  const how = { hit: 'cache hit', miss: 'cache miss', bypass: 'cache bypassed (force)' }[meta.cache];
  return `intent.load: ${how}`;
}

/**
 * `intent.resolve_refs: Linked issue #12: found, Plan at x.md: not_found`, or
 * `not reached (<reason>)` when resolution never ran. Logged regardless of outcome: refs
 * resolved before a later failure are still shown.
 */
export function resolveRefsLine(meta?: DeriveMeta, reason?: string): string {
  if (!meta || meta.refsReached === false) {
    return `intent.resolve_refs: not reached (${asciiSafe(reason ?? 'unknown')})`;
  }
  if (meta.refSources.length === 0) return 'intent.resolve_refs: no references in PR title/body';
  const parts = meta.refSources.map((r) => `${r.label}: ${STATUS_WORD[r.status]}`);
  return `intent.resolve_refs: ${parts.join(', ')}`;
}

/**
 * The ONE definition of the `intent=` part of the `llm.calls` line. `attempts` = structured
 * LLM HTTP attempts (reprompts included); for a failed call it is a lower bound (the
 * provider error does not report how many attempts it made), 0 = never called.
 *
 *   derived, 1 attempt       -> `1 ok`
 *   derived, N>1 attempts    -> `N (retried, N attempts) ok`
 *   cached                   -> `0 cached`          (no LLM call)
 *   failed before the call   -> `0 skipped`         (e.g. provider setup / cache lookup error)
 *   failed after 1 attempt   -> `1 failed`
 *   failed, N>1 attempts     -> `N (retried, N attempts) failed`
 */
export function intentCallsLabel(o: { status: 'derived' | 'cached' | 'failed'; attempts: number }): string {
  if (o.status === 'cached') return '0 cached';
  const n = o.attempts;
  if (o.status === 'failed' && n === 0) return '0 skipped';
  const calls = n > 1 ? `${n} (retried, ${n} attempts)` : `${n}`;
  return `${calls} ${o.status === 'derived' ? 'ok' : 'failed'}`;
}

/** `llm.calls: intent=<label> review=<n>` */
export function llmCallsLine(
  o: { status: 'derived' | 'cached' | 'failed'; attempts: number },
  reviewCalls: number,
): string {
  return `llm.calls: intent=${intentCallsLabel(o)} review=${reviewCalls}`;
}

/**
 * How a derived intent is used by the REVIEW prompt:
 *  - confidence 0 (no description, files or sources): the Intent section is omitted;
 *  - 0 < confidence < MIN_INTENT_CONFIDENCE: included (reviewer-core marks it as a weak
 *    hint), the scope filter stays inactive (applyScopePolicy);
 *  - otherwise: included as is.
 * The intent itself is persisted/served regardless.
 */
export function reviewIntentPolicy(intent?: Intent): { include: boolean; line?: string } {
  if (!intent) return { include: false };
  if (intent.confidence === 0) {
    return {
      include: false,
      line: 'intent.skip: confidence=0 (no description, files or sources); Intent section omitted from review prompt',
    };
  }
  if (intent.confidence < MIN_INTENT_CONFIDENCE) {
    return {
      include: true,
      line:
        `intent.low_confidence: confidence=${intent.confidence.toFixed(2)} < ${MIN_INTENT_CONFIDENCE.toFixed(2)}; ` +
        'Intent section marked as weak hint in review prompt; scope filter inactive',
    };
  }
  return { include: true };
}

/** Prompt composition (counts), est. tokens, actual tokens and cost of the LLM call. */
export function llmDetails(meta: DeriveMeta): string {
  const out: string[] = [];
  const p = meta.prompt;
  if (p) {
    out.push(
      `files=${p.files} files_in_prompt=${p.filesIncluded} hunk_headers=${p.hunkHeaders}` +
        ` body_chars=${p.bodyChars} body_truncated=${p.bodyTruncated ? 'yes' : 'no'}` +
        ` refs=[${p.refs.join(', ')}] no_context_refs=${p.unavailableRefs}`,
    );
  }
  if (meta.estPromptTokens !== undefined) out.push(`est_prompt_tokens=~${meta.estPromptTokens}`);
  if (meta.tokensIn !== undefined) out.push(`tokens_in=${meta.tokensIn} tokens_out=${meta.tokensOut ?? 0}`);
  if (meta.model !== undefined) {
    out.push(`cost_usd=${meta.costUsd == null ? 'unknown' : `$${meta.costUsd.toFixed(6)}`}`);
  }
  return out.join(', ');
}
