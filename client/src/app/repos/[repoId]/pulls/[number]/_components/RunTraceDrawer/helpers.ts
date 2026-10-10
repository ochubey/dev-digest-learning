import type { LogLine } from "@devdigest/ui";
import { SOFT_CAP_TOKENS } from "@/components/project-context/constants";
import type { RunTrace, SpecReadEntry, SpecSkipReason } from "@devdigest/shared";

interface RawEvent {
  t: string;
  kind: string;
  msg: string;
}

/** Map run-bus events to the LiveLogStream LogLine shape. */
export function eventsToLog(events: RawEvent[]): LogLine[] {
  return events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
}

/** Map a persisted trace's log to the LiveLogStream LogLine shape. */
export function traceLog(trace: RunTrace | undefined): LogLine[] {
  return trace?.log.map((l) => ({ t: l.t, k: l.kind as LogLine["k"], m: l.msg })) ?? [];
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}

/** Compact per-skill token count for the "Skills loaded" badges (e.g. "820" or "1.2k"). */
export function formatSkillTokens(tokens: number): string {
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
}

/** One "Specs read" row, normalized from either a legacy path string or a SpecReadEntry. */
export interface SpecRow {
  path: string;
  tokens: number | null;
  status: "injected" | "skipped";
  reason: SpecSkipReason | null;
  origin: "agent" | "skill";
  skillName: string | null;
}

/** Legacy traces store plain path strings (treated as injected, token count unknown). */
export function normalizeSpecsRead(specsRead: RunTrace["specs_read"] | undefined): SpecRow[] {
  return (specsRead ?? []).map((sp: string | SpecReadEntry): SpecRow =>
    typeof sp === "string"
      ? { path: sp, tokens: null, status: "injected", reason: null, origin: "agent", skillName: null }
      : {
          path: sp.path,
          // Skipped rows never show a count, whatever an older trace stored.
          tokens: sp.status === "skipped" ? null : sp.tokens,
          status: sp.status,
          reason: sp.reason ?? null,
          origin: sp.origin,
          skillName: sp.skill_name ?? null,
        },
  );
}

/** A project-context prompt entry; `path` is null for the legacy single `specs` string. */
export interface ProjectContextEntry {
  path: string | null;
  tokens: number | null;
  text: string;
}

/** Exact stored per-document blocks, or the legacy joined `specs` string as one entry. */
export function projectContextEntries(trace: RunTrace): ProjectContextEntry[] {
  const blocks = trace.prompt_assembly.project_context_blocks;
  if (blocks && blocks.length > 0) return blocks.map((b) => ({ path: b.path, tokens: b.tokens, text: b.text }));
  const legacy = trace.prompt_assembly.specs;
  return legacy ? [{ path: null, tokens: null, text: legacy }] : [];
}

/** Injected token total (stored value, else summed from rows) and whether it passes the soft cap. */
export function specsTokenSummary(
  rows: SpecRow[],
  stored: RunTrace["project_context"],
): { tokens: number; softCapExceeded: boolean } {
  const tokens =
    stored?.injected_tokens ??
    rows.reduce((n, r) => (r.status === "injected" ? n + (r.tokens ?? 0) : n), 0);
  return { tokens, softCapExceeded: tokens > SOFT_CAP_TOKENS };
}
