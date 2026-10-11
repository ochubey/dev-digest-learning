/** Builders shared by the evals dashboard tests. */
import type { EvalCaseResult, EvalRunManifest, EvalSuiteRun, EvalSuiteRunDetail } from "@devdigest/shared";

export function mkRun(over: Partial<EvalSuiteRun> = {}): EvalSuiteRun {
  return {
    id: "r1",
    agent_id: "a1",
    agent_name: "Security reviewer",
    agent_version: 2,
    status: "completed",
    error: null,
    cases_total: 8,
    cases_done: 8,
    metrics: { recall: 0.875, precision: 0.5, citation_accuracy: 1 },
    counts: { cases_passed: 6 } as EvalSuiteRun["counts"],
    duration_ms: 1000,
    cost_usd: 0.0123,
    started_at: "2026-10-11T10:00:00Z",
    finished_at: "2026-10-11T10:01:00Z",
    ...over,
  };
}

export function mkManifest(over: Partial<EvalRunManifest> = {}): EvalRunManifest {
  return {
    provider: "openai",
    model: "gpt-test",
    system_prompt: "You review code",
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skills: [],
    skill_versions: [],
    ...over,
  };
}

export function mkResult(over: Partial<EvalCaseResult> = {}): EvalCaseResult {
  return {
    id: "res1",
    case_id: "c1",
    case_name: "SQL injection in query",
    expectation: { kind: "must_find", file: "src/db.ts", start_line: 10, end_line: 12 },
    origin: "seeded",
    status: "ok",
    pass: true,
    grounded: [],
    dropped: [],
    duration_ms: 10,
    tokens_in: 1,
    tokens_out: 1,
    cost_usd: 0.001,
    error: null,
    ...over,
  };
}

export function mkDetail(over: Partial<EvalSuiteRunDetail> = {}): EvalSuiteRunDetail {
  return { ...mkRun(), manifest: mkManifest(), results: [], ...over };
}
