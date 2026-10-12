import type {
  EvalCaseResult,
  EvalCaseView,
  EvalRunManifest,
  EvalSuiteRun,
  EvalSuiteRunDetail,
} from "@devdigest/shared";

const RAN_AT = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Human run time, e.g. "Oct 11, 2026, 10:00 AM". Falls back to the raw value if unparsable. */
export function formatRanAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : RAN_AT.format(d);
}

/** "X/Y" for Cases passed: Y is the scored cases (AC-18/51), null passed when the run has no counts. */
export function passedParts(run: Pick<EvalSuiteRun, "counts">): { passed: number | null; total: number } {
  return { passed: run.counts?.cases_passed ?? null, total: run.counts?.cases_scored ?? 0 };
}

export type CaseState = "pass" | "fail" | "error" | "pending";

/** Display state of one case result. */
export function caseState(r: Pick<EvalCaseResult, "status" | "pass">): CaseState {
  if (r.status === "error") return "error";
  if (r.status === "pending" || r.pass == null) return "pending";
  return r.pass ? "pass" : "fail";
}

export { diffWords, type DiffToken } from "@/lib/text-diff";

export type EvalMetricKey = "recall" | "precision" | "citation_accuracy";

const FINISHED = new Set<EvalSuiteRun["status"]>(["completed", "completed_with_errors"]);
const byStartedDesc = (a: { started_at: string }, b: { started_at: string }) =>
  Date.parse(b.started_at) - Date.parse(a.started_at);

/** Whole percentage, or "—" when the metric is null. */
export function formatPct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

/** Delta in percentage points between the displayed (rounded) values: "▲ 13pt" / "▼ 25pt" / "0pt".
    null when either side is null, so a null metric never shows a delta (AC-52). */
export function deltaPt(current: number | null | undefined, previous: number | null | undefined): string | null {
  if (current == null || previous == null) return null;
  const d = Math.round(current * 100) - Math.round(previous * 100);
  if (d === 0) return "0pt";
  return `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}pt`;
}

export type NullReasonKey = "noMustFind" | "noFindingsReturned" | "noFindingsProduced";

/** `evals` message key (`metric.nullReason.<key>`) explaining why a metric is null (AC-52). */
export function nullReason(metric: EvalMetricKey): NullReasonKey {
  if (metric === "recall") return "noMustFind";
  if (metric === "precision") return "noFindingsReturned";
  return "noFindingsProduced";
}

/** AC-17: `must_find` first, then name ascending. Returns a new array. */
export function sortCases<T extends Pick<EvalCaseView, "name" | "expectation">>(cases: readonly T[]): T[] {
  const rank = (c: T) => (c.expectation.kind === "must_find" ? 0 : 1);
  return [...cases].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "en"));
}

/** Newest finished (`completed` or `completed_with_errors`) run, or null. */
export function latestFinished<T extends EvalSuiteRun>(runs: readonly T[]): T | null {
  return [...runs].filter((r) => FINISHED.has(r.status)).sort(byStartedDesc)[0] ?? null;
}

/** The finished run before `latestFinished`, or null. */
export function previousFinished<T extends EvalSuiteRun>(runs: readonly T[]): T | null {
  return [...runs].filter((r) => FINISHED.has(r.status)).sort(byStartedDesc)[1] ?? null;
}

/** AC-54: set when the latest finished run used an older agent version than the current one. */
export function versionDrift(
  latest: Pick<EvalSuiteRun, "agent_version"> | null,
  agentVersion: number | null | undefined,
): { from: number; to: number } | null {
  if (!latest || agentVersion == null || latest.agent_version >= agentVersion) return null;
  return { from: latest.agent_version, to: agentVersion };
}

/** AC-67: [older, newer] by run time. */
export function orderPair<T extends Pick<EvalSuiteRun, "started_at">>(a: T, b: T): [T, T] {
  return Date.parse(a.started_at) <= Date.parse(b.started_at) ? [a, b] : [b, a];
}

export interface CaseChange {
  key: string;
  name: string;
  a: EvalCaseResult;
  b: EvalCaseResult;
}

export interface CaseChanges {
  regressed: CaseChange[];
  fixed: CaseChange[];
  errored: CaseChange[];
  unchanged: number;
  onlyA: EvalCaseResult[];
  onlyB: EvalCaseResult[];
}

const caseKey = (r: EvalCaseResult) => (r.case_id ? `id:${r.case_id}` : `name:${r.case_name}`);

/** AC-70/AC-71: per-case differences between an older run `a` and a newer run `b`. Cases are
    matched by `case_id`, falling back to the snapshot name for deleted cases. A case that was
    already an error in `a` and is scored (or still an error) in `b` counts as unchanged. */
export function caseChanges(a: EvalSuiteRunDetail, b: EvalSuiteRunDetail): CaseChanges {
  const inB = new Map(b.results.map((r) => [caseKey(r), r]));
  const seen = new Set<string>();
  const out: CaseChanges = { regressed: [], fixed: [], errored: [], unchanged: 0, onlyA: [], onlyB: [] };
  for (const ra of a.results) {
    const key = caseKey(ra);
    const rb = inB.get(key);
    if (!rb) {
      out.onlyA.push(ra);
      continue;
    }
    seen.add(key);
    const change: CaseChange = { key, name: rb.case_name, a: ra, b: rb };
    if (rb.status === "error" && ra.status !== "error") out.errored.push(change);
    else if (ra.pass === true && rb.pass === false) out.regressed.push(change);
    else if (ra.pass === false && rb.pass === true) out.fixed.push(change);
    else out.unchanged += 1;
  }
  for (const rb of b.results) if (!seen.has(caseKey(rb))) out.onlyB.push(rb);
  return out;
}

export interface ManifestDiff {
  fields: { key: "provider" | "model" | "strategy" | "ci_fail_on" | "repo_intel"; from: string; to: string }[];
  skillsAdded: string[];
  skillsRemoved: string[];
  skillVersionChanges: { name: string; from: number; to: number }[];
  promptChanged: boolean;
}

const FIELD_KEYS = ["provider", "model", "strategy", "ci_fail_on", "repo_intel"] as const;

/** AC-69: manifest differences other than the prompt text (which is shown as a word diff). */
export function manifestDiff(a: EvalRunManifest, b: EvalRunManifest): ManifestDiff {
  const fields: ManifestDiff["fields"] = [];
  for (const key of FIELD_KEYS) {
    if (a[key] !== b[key]) fields.push({ key, from: String(a[key]), to: String(b[key]) });
  }
  const nameOf = (m: EvalRunManifest, id: string) => m.skill_versions.find((s) => s.id === id)?.name ?? id;
  const inA = new Set(a.skills);
  const inB = new Set(b.skills);
  const verA = new Map(a.skill_versions.map((s) => [s.id, s]));
  const skillVersionChanges: ManifestDiff["skillVersionChanges"] = [];
  for (const s of b.skill_versions) {
    const prev = verA.get(s.id);
    if (prev && prev.version !== s.version) skillVersionChanges.push({ name: s.name, from: prev.version, to: s.version });
  }
  return {
    fields,
    skillsAdded: b.skills.filter((id) => !inA.has(id)).map((id) => nameOf(b, id)),
    skillsRemoved: a.skills.filter((id) => !inB.has(id)).map((id) => nameOf(a, id)),
    skillVersionChanges,
    promptChanged: a.system_prompt !== b.system_prompt,
  };
}

export type CaseResultLabel = "pass" | "fail" | "error" | "never";

/** Result of an agent's most recent run for one case; `never` when it was never scored. */
export function caseResultLabel(c: Pick<EvalCaseView, "last_result">): CaseResultLabel {
  return c.last_result?.status ?? "never";
}

export interface CaseResultDetail {
  /** `evalsTab` message key under `detail.` */
  key: "mustFindHit" | "mustFindMiss" | "mustNotFlagClean" | "mustNotFlagHit" | "error" | "errorUnknown";
  /** Matching findings the last run returned for this case. */
  count: number;
  /** Runner error text (plain text only); set for `error`. */
  error: string | null;
}

/** One-line explanation of the last result, e.g. must-find miss = "expected ≥1 matching finding, got 0".
    null when the case was never run. */
export function caseResultDetail(c: Pick<EvalCaseView, "last_result" | "expectation">): CaseResultDetail | null {
  const r = c.last_result;
  if (!r) return null;
  if (r.status === "error") {
    return { key: r.error ? "error" : "errorUnknown", count: r.matched, error: r.error };
  }
  const mustFind = c.expectation.kind === "must_find";
  const key = mustFind
    ? r.matched > 0 ? "mustFindHit" : "mustFindMiss"
    : r.matched > 0 ? "mustNotFlagHit" : "mustNotFlagClean";
  return { key, count: r.matched, error: null };
}

/** Short form of a model id for tables: the part after the last "/" ("—"-style null stays null). */
export function shortModel(model: string | null | undefined): string | null {
  if (!model) return null;
  const i = model.lastIndexOf("/");
  return i >= 0 && i < model.length - 1 ? model.slice(i + 1) : model;
}
