import type { Finding, Intent, Review } from '@devdigest/shared';

/**
 * Code-owned scope policy. The model only LABELS each finding (`scope` /
 * `scope_reason` hints, see ModelFinding); this module decides. Pure, no extra
 * LLM call, no input mutation, independent of input order.
 *
 * Order: (1) filter-inactive short-circuit, (2) normalise hints, (3) never-out
 * overrides, (4) mass-out guard, (5) collapse serious outs into ONE signal,
 * (6) write scope/scope_reason (code always overwrites the model's values).
 */

/** Intent below this confidence disables the filter. */
export const MIN_INTENT_CONFIDENCE = 0.5;
/** Proposed outs above this share of all findings trip the mass-out guard. */
export const MAX_OUT_RATIO = 0.6;
/** The ratio rule only applies with at least this many findings. */
export const MIN_FINDINGS_FOR_RATIO = 3;
/** Max chars of the model's reason kept in scope_reason. */
export const MAX_SCOPE_REASON_CHARS = 280;
/** Categories the model may never push out of scope. */
export const NEVER_OUT_CATEGORIES: ReadonlySet<string> = new Set(['security']);
/** Finding kinds the model may never push out of scope. */
export const NEVER_OUT_KINDS: ReadonlySet<string> = new Set(['secret_leak', 'lethal_trifecta']);

export type ScopeLabel = 'in' | 'out' | 'signal';

export interface ScopeStats {
  total: number;
  in: number;
  out: number;
  signal: number;
  /** Findings with scope 'out' (includes collapsed ones). */
  hidden: number;
  /** Serious outs collapsed into the single signal (subset of hidden). */
  collapsed: number;
  /** What the model proposed (before any policy decision). */
  modelHints: { in: number; out: number; signal: number; invalid: number };
  overrides: { criticalChanged: number; security: number; secretKind: number; invalid: number };
  /** Sum of `overrides` (computed once here; consumers must not re-add). */
  overridesTotal: number;
  guardTripped: boolean;
  /** False when the filter was inactive (no/low-confidence/empty intent). */
  active: boolean;
}

export interface ScopeOverride {
  id: string;
  title: string;
  cause: 'security' | 'secret_kind' | 'critical_changed';
  reason: string;
}

export interface ScopePolicyResult {
  /** Every finding, annotated (in/out/signal), in input order. Persist these. */
  all: Finding[];
  /** scope === 'in'. */
  visible: Finding[];
  /** scope === 'out' (hidden but persisted). */
  hidden: Finding[];
  /** The single signal finding, if any (NOT part of visible/hidden). */
  signal?: Finding;
  stats: ScopeStats;
  /** One entry per model=out -> in override (security/secret/critical-on-changed). */
  overrideLog: ScopeOverride[];
}

export interface ScopePolicyInput {
  intent?: Intent;
  changedLines: Map<string, Set<number>>;
}

type Hint = ScopeLabel | 'invalid';

function readHint(f: Pick<Finding, 'scope'>): Hint {
  const s = f.scope;
  return s === 'in' || s === 'out' || s === 'signal' ? s : 'invalid';
}

function cleanReason(r: unknown): string {
  if (typeof r !== 'string') return '';
  const flat = r.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_SCOPE_REASON_CHARS ? flat.slice(0, MAX_SCOPE_REASON_CHARS) : flat;
}

function overlapsChanged(f: Finding, lines: Set<number> | undefined): boolean {
  if (!lines || lines.size === 0) return false;
  const lo = Math.min(f.start_line, f.end_line);
  const hi = Math.max(f.start_line, f.end_line);
  for (let n = lo; n <= hi; n++) if (lines.has(n)) return true;
  return false;
}

function inactiveWhy(intent: Intent | undefined): string | null {
  if (!intent) return 'no intent';
  if (intent.confidence < MIN_INTENT_CONFIDENCE)
    return `intent confidence ${intent.confidence} < ${MIN_INTENT_CONFIDENCE}`;
  if (intent.in_scope.length === 0 && intent.out_of_scope.length === 0)
    return 'intent has no in_scope/out_of_scope';
  return null;
}

function emptyStats(total: number, active: boolean): ScopeStats {
  return {
    total,
    in: 0,
    out: 0,
    signal: 0,
    hidden: 0,
    collapsed: 0,
    modelHints: { in: 0, out: 0, signal: 0, invalid: 0 },
    overrides: { criticalChanged: 0, security: 0, secretKind: 0, invalid: 0 },
    overridesTotal: 0,
    guardTripped: false,
    active,
  };
}

function modelSuffix(hint: Hint, f: Finding): string {
  const reason = cleanReason(f.scope_reason);
  const label = hint === 'invalid' ? 'none' : hint;
  return `; model: ${label}${reason ? ` — ${reason}` : ''}`;
}

export function applyScopePolicy(findings: Finding[], input: ScopePolicyInput): ScopePolicyResult {
  const stats = emptyStats(findings.length, true);
  const overrideLog: ScopeOverride[] = [];

  const why = inactiveWhy(input.intent);
  if (why) {
    stats.active = false;
    const all = findings.map((f) => ({
      ...f,
      scope: 'in' as const,
      scope_reason: `scope filter inactive: ${why}`,
    }));
    stats.in = all.length;
    // Filter inactive: nothing is overridden (`invalid` only counts when active).
    return { all, visible: all, hidden: [], stats, overrideLog };
  }

  // (2) normalise hints; (3) never-out overrides.
  interface Slot {
    f: Finding;
    hint: Hint;
    label: 'in' | 'out';
    decision: string;
  }
  const slots: Slot[] = findings.map((f) => {
    const hint = readHint(f);
    if (hint === 'invalid') {
      stats.modelHints.invalid++;
      stats.overrides.invalid++;
      return { f, hint, label: 'in', decision: 'in scope (missing/invalid model hint)' };
    }
    stats.modelHints[hint]++;
    if (hint === 'in') return { f, hint, label: 'in', decision: 'in scope' };
    // model proposes out (a model 'signal' is treated as out)
    const override = (cause: ScopeOverride['cause'], reason: string): Slot => {
      overrideLog.push({ id: f.id, title: f.title, cause, reason });
      return { f, hint, label: 'in', decision: `in scope (override: ${reason})` };
    };
    if (NEVER_OUT_CATEGORIES.has(f.category)) {
      stats.overrides.security++;
      return override('security', `category ${f.category} is never out of scope`);
    }
    if (f.kind && NEVER_OUT_KINDS.has(f.kind)) {
      stats.overrides.secretKind++;
      return override('secret_kind', `kind ${f.kind} is never out of scope`);
    }
    if (f.severity === 'CRITICAL' && overlapsChanged(f, input.changedLines.get(f.file))) {
      stats.overrides.criticalChanged++;
      return override('critical_changed', 'CRITICAL on changed lines');
    }
    return { f, hint, label: 'out', decision: 'out of scope' };
  });

  // (4) mass-out guard
  const total = slots.length;
  const outs = slots.filter((s) => s.label === 'out').length;
  const tripped =
    (total >= MIN_FINDINGS_FOR_RATIO && outs > MAX_OUT_RATIO * total) || (total >= 2 && outs === total);
  if (tripped) {
    stats.guardTripped = true;
    for (const s of slots) {
      if (s.label === 'out') {
        s.label = 'in';
        s.decision = 'in scope (mass out-of-scope guard tripped)';
      }
    }
  }

  // (5) collapse serious outs into exactly one signal
  const serious = slots
    .filter((s) => s.label === 'out' && s.f.severity === 'CRITICAL')
    .sort(
      (a, b) =>
        b.f.confidence - a.f.confidence ||
        (a.f.file < b.f.file ? -1 : a.f.file > b.f.file ? 1 : 0) ||
        a.f.start_line - b.f.start_line ||
        (a.f.id < b.f.id ? -1 : a.f.id > b.f.id ? 1 : 0),
    );
  const top = serious[0];
  if (top) {
    const others = serious.length - 1;
    for (const s of serious.slice(1)) {
      s.decision = `out of scope; collapsed into signal ${top.f.id}`;
      stats.collapsed++;
    }
    top.decision = `Outside PR intent but serious; ${others} other serious out-of-scope finding(s) collapsed`;
  }

  // (6) write scope + scope_reason
  const all: Finding[] = [];
  const visible: Finding[] = [];
  const hidden: Finding[] = [];
  let signal: Finding | undefined;
  for (const s of slots) {
    const scope: ScopeLabel = s === top ? 'signal' : s.label;
    const out: Finding = {
      ...s.f,
      scope,
      scope_reason: `${s.decision}${modelSuffix(s.hint, s.f)}`,
    };
    all.push(out);
    if (scope === 'in') visible.push(out);
    else if (scope === 'out') hidden.push(out);
    else signal = out;
  }

  const ov = stats.overrides;
  stats.overridesTotal = ov.criticalChanged + ov.security + ov.secretKind + ov.invalid;
  stats.in = visible.length;
  stats.out = hidden.length;
  stats.hidden = hidden.length;
  stats.signal = signal ? 1 : 0;

  return { all, visible, hidden, ...(signal ? { signal } : {}), stats, overrideLog };
}

/**
 * Verdict after the scope policy. Score + verdict come from scope=in findings
 * ONLY; the signal is shown separately and never affects them. When nothing was
 * hidden/signalled the model's reduced verdict is kept; otherwise it is
 * re-derived from the in findings (the model's verdict may have been driven by
 * findings now hidden).
 */
export function deriveScopedVerdict(
  modelVerdict: Review['verdict'],
  scoped: Pick<ScopePolicyResult, 'visible' | 'hidden' | 'signal'>,
): Review['verdict'] {
  if (scoped.hidden.length === 0 && !scoped.signal) return modelVerdict;
  if (scoped.visible.some((f) => f.severity === 'CRITICAL')) return 'request_changes';
  return scoped.visible.length > 0 ? 'comment' : 'approve';
}

/** The single human-readable "Scope policy:" log line for a run's stats. */
export function formatScopeStats(st: ScopeStats): string {
  const ov = st.overrides;
  return (
    `Scope policy: in=${st.in} out=${st.out} signal=${st.signal} hidden=${st.hidden} ` +
    `collapsed=${st.collapsed} overrides=${st.overridesTotal} ` +
    `(critical_changed=${ov.criticalChanged} security=${ov.security} secret=${ov.secretKind} ` +
    `invalid=${ov.invalid}) guard=${st.guardTripped ? 'tripped' : 'ok'} ` +
    `model_out=${st.modelHints.out + st.modelHints.signal}`
  );
}
