import {
  EvalCaseMeta,
  EvalExpectation,
  type EvalCaseLastResult,
  type EvalCaseOrigin,
  type EvalCaseResult,
  type EvalCaseView,
  type EvalDroppedFinding,
  type EvalResultFinding,
  type EvalRunCounts,
  type EvalRunManifest,
  type EvalSuiteRun,
  type EvalSuiteRunDetail,
} from '@devdigest/shared';

/**
 * Pure row -> contract mapping for the evals repository. Rows are passed as plain
 * structural types so these functions have no DB or drizzle imports.
 */

export interface CaseRowLike {
  id: string;
  ownerId: string;
  name: string;
  inputDiff: string | null;
  inputMeta: unknown;
  expectedOutput: unknown;
  notes: string | null;
}

export interface SuiteRunRowLike {
  id: string;
  agentId: string;
  agentVersion: number | null;
  manifest: unknown;
  status: EvalSuiteRun['status'];
  error: string | null;
  casesTotal: number | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  counts: unknown;
  durationMs: number | null;
  costUsd: number | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface ResultRowLike {
  id: string;
  caseId: string | null;
  suiteRunId: string | null;
  status: string | null;
  caseSnapshot: unknown;
  error: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  actualOutput: unknown;
  pass: boolean | null;
  durationMs: number | null;
  costUsd: number | null;
  ranAt: Date;
}

/** A stored case with its fixed inputs, as the runner and the views need it. */
export interface StoredCase {
  id: string;
  agent_id: string;
  name: string;
  expectation: EvalExpectation;
  input_diff: string;
  notes: string | null;
  meta: EvalCaseMeta;
}

export function toStoredCase(row: CaseRowLike): StoredCase {
  return {
    id: row.id,
    agent_id: row.ownerId,
    name: row.name,
    expectation: EvalExpectation.parse(row.expectedOutput),
    input_diff: row.inputDiff ?? '',
    notes: row.notes,
    meta: EvalCaseMeta.parse(row.inputMeta ?? { origin: 'seeded' }),
  };
}

export function toCaseView(c: StoredCase, last: EvalCaseLastResult | null): EvalCaseView {
  return {
    id: c.id,
    agent_id: c.agent_id,
    name: c.name,
    expectation: c.expectation,
    input_diff: c.input_diff,
    notes: c.notes,
    origin: c.meta.origin,
    source_finding_id: c.meta.source_finding_id ?? null,
    source_pr_id: c.meta.source_pr_id ?? null,
    last_result: last,
  };
}

interface StoredOutput {
  grounded?: EvalResultFinding[];
  dropped?: EvalDroppedFinding[];
}

export function toResult(row: ResultRowLike): EvalCaseResult {
  const snap = (row.caseSnapshot ?? {}) as { name?: string; expectation?: EvalExpectation; origin?: EvalCaseOrigin };
  const out = (row.actualOutput ?? {}) as StoredOutput;
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: snap.name ?? '',
    expectation: snap.expectation as EvalExpectation,
    origin: snap.origin ?? 'seeded',
    status: (row.status ?? 'pending') as EvalCaseResult['status'],
    pass: row.pass,
    grounded: out.grounded ?? [],
    dropped: out.dropped ?? [],
    duration_ms: row.durationMs,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    error: row.error,
  };
}

/** The "last result" chip of a case, from its newest finished result row. */
export function toLastResult(runId: string, row: ResultRowLike): EvalCaseLastResult {
  const r = toResult(row);
  return {
    run_id: runId,
    status: r.status === 'error' ? 'error' : r.pass ? 'pass' : 'fail',
    matched: r.grounded.filter((f) => f.match !== 'unlabeled').length,
    kind: r.expectation.kind,
    error: r.error,
  };
}

export function toSuiteRun(row: SuiteRunRowLike, casesDone: number, agentName?: string | null): EvalSuiteRun {
  return {
    id: row.id,
    agent_id: row.agentId,
    ...(agentName !== undefined ? { agent_name: agentName } : {}),
    agent_version: row.agentVersion ?? 0,
    status: row.status,
    error: row.error,
    cases_total: row.casesTotal ?? casesDone,
    cases_done: casesDone,
    metrics: { recall: row.recall, precision: row.precision, citation_accuracy: row.citationAccuracy },
    counts: (row.counts as EvalRunCounts | null) ?? null,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

export function toSuiteRunDetail(
  row: SuiteRunRowLike,
  results: ResultRowLike[],
  agentName?: string | null,
): EvalSuiteRunDetail {
  const mapped = results.map(toResult);
  const done = mapped.filter((r) => r.status !== 'pending').length;
  return {
    ...toSuiteRun(row, done, agentName),
    manifest: row.manifest as EvalRunManifest,
    results: mapped,
  };
}
