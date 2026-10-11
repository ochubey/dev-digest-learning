import type { EvalCaseOrigin, EvalCaseResult, EvalExpectation, EvalRunManifest, LLMProvider } from '@devdigest/shared';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { TimeoutError, withTimeout } from '../../platform/resilience.js';
import { mapLimit } from '../project-context/map-limit.js';
import { EVAL_TASK_LINE } from './constants.js';
import { caseErrorLine } from './log-lines.js';
import { scoreCase } from './scoring.js';

/** One case to run. `id` is the id of its (pending) result row. */
export interface RunnableCase {
  id: string;
  case_id: string | null;
  name: string;
  expectation: EvalExpectation;
  origin: EvalCaseOrigin;
  input_diff: string;
}

export interface RunEvalCasesArgs {
  cases: RunnableCase[];
  manifest: EvalRunManifest;
  /** Bodies of the enabled linked skills, in link order, captured when the run started. */
  skillBodies: string[];
  llm: LLMProvider;
  concurrency: number;
  timeoutMs: number;
  /** Called once per finished case (ok or error); a throw aborts the remaining cases. */
  onResult?: (result: EvalCaseResult) => void | Promise<void>;
  /** Receives one `caseErrorLine` per errored case. Never receives fragment or model text. */
  log?: (line: string) => void;
}

const REASON_MAX = 300;

/** Provider keys / bearer tokens / `*_API_KEY=` assignments are replaced before a message is stored. */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b[A-Z0-9_]*API_KEY\b\s*[=:]\s*\S+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{8,}/g,
];

/** AC-39: first line only, secrets redacted, at most 300 characters; a timeout reads "timeout". */
export function sanitizeError(err: unknown): string {
  if (err instanceof TimeoutError) return 'timeout';
  const raw = err instanceof Error ? err.message : String(err);
  let first = (raw.split('\n')[0] ?? '').trim();
  for (const re of SECRET_PATTERNS) first = first.replace(re, '[redacted]');
  return first.slice(0, REASON_MAX) || 'review failed';
}

/** The runner stops early when a result sink fails; this carries that first failure. */
class SinkError extends Error {
  constructor(readonly original: unknown) {
    super('eval result sink failed');
  }
}

/**
 * Runs each case as one stateless review: a fresh message list, no tools, and only the
 * manifest's prompt/model/strategy, the recorded skill bodies, the case's stored fragment
 * and a fixed task line (AC-34..AC-36, AC-88). No PR description, intent, repo map,
 * callers, project context or memory is passed. Never touches the DB.
 */
export async function runEvalCases(args: RunEvalCasesArgs): Promise<EvalCaseResult[]> {
  let sinkFailure: SinkError | null = null;

  const runOne = async (c: RunnableCase): Promise<EvalCaseResult> => {
    const base = { id: c.id, case_id: c.case_id, case_name: c.name, expectation: c.expectation, origin: c.origin };
    if (sinkFailure) {
      return { ...base, status: 'error', pass: null, grounded: [], dropped: [], duration_ms: null, tokens_in: null, tokens_out: null, cost_usd: null, error: 'aborted' };
    }
    const started = Date.now();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
    }, args.timeoutMs);
    let result: EvalCaseResult;
    try {
      const outcome = await withTimeout(
        reviewPullRequest({
          systemPrompt: args.manifest.system_prompt,
          model: args.manifest.model,
          strategy: args.manifest.strategy,
          ...(args.skillBodies.length > 0 ? { skills: args.skillBodies } : {}),
          diff: parseUnifiedDiff(c.input_diff),
          llm: args.llm,
          task: EVAL_TASK_LINE,
          // After the timeout fires, map-reduce must not start its next chunk call.
          checkCancelled: () => {
            if (timedOut) throw new TimeoutError(args.timeoutMs);
          },
        }),
        args.timeoutMs,
      );
      const score = scoreCase(c.expectation, outcome.allFindings);
      result = {
        ...base,
        status: 'ok',
        pass: score.pass,
        grounded: outcome.allFindings.map((f, i) => ({
          file: f.file,
          start_line: f.start_line,
          end_line: f.end_line,
          severity: f.severity,
          category: f.category,
          title: f.title,
          match: score.labels[i]!,
        })),
        dropped: outcome.dropped.map((d) => ({
          file: d.finding.file,
          start_line: d.finding.start_line,
          end_line: d.finding.end_line,
          title: d.finding.title,
          reason: d.reason,
        })),
        duration_ms: Date.now() - started,
        tokens_in: outcome.tokensIn,
        tokens_out: outcome.tokensOut,
        cost_usd: outcome.costUsd,
        error: null,
      };
    } catch (err) {
      const reason = sanitizeError(err);
      args.log?.(caseErrorLine(c.case_id ?? c.id, reason));
      result = {
        ...base,
        status: 'error',
        pass: null,
        grounded: [],
        dropped: [],
        duration_ms: Date.now() - started,
        tokens_in: null,
        tokens_out: null,
        cost_usd: null,
        error: reason,
      };
    }
    clearTimeout(timer);
    try {
      await args.onResult?.(result);
    } catch (err) {
      sinkFailure ??= new SinkError(err);
    }
    return result;
  };

  const results = await mapLimit(args.cases, args.concurrency, runOne);
  if (sinkFailure) throw (sinkFailure as SinkError).original;
  return results;
}
