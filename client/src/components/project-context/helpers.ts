import type { ContextDoc, ContextSource, InheritedContextDoc } from "@devdigest/shared";
import { SERIALIZE_HEADINGS, SOFT_CAP_TOKENS, SOURCE_FOLDERS, SOURCE_ORDER } from "./constants";

/** One displayed row of the picker. */
export interface ContextRow {
  /** Stable React / dnd id: the path, `inherited:<path>` for read-only rows. */
  key: string;
  kind: "attached" | "available" | "inherited";
  path: string;
  name: string;
  folder: string;
  source: ContextSource | null;
  /** null when the size is unknown (stale / unverified rows). */
  tokens: number | null;
  attached: boolean;
  /** Attached but absent from the discovered docs (AC-12). */
  stale: boolean;
  /** Attached while discovery is unavailable, so existence is unknown (AC-13). */
  unverified: boolean;
  viaSkill?: string;
}

/** `640` -> "640", `1234` -> "1.2K", `3000` -> "3K" (AC-5). */
export function formatDocTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
}

/** Mirrors the server's classifySource: first specs/docs/insights folder segment wins (the file name is not a folder), else `root` for a root file, else `other`. */
export function sourceOfPath(path: string): ContextSource {
  const folders = path.split("/").slice(0, -1);
  for (const f of folders) {
    const hit = SOURCE_FOLDERS.find((s) => s === f);
    if (hit) return hit;
  }
  return folders.length === 0 ? "root" : "other";
}

function fromDoc(doc: ContextDoc, kind: ContextRow["kind"], extra: Partial<ContextRow> = {}): ContextRow {
  return {
    key: kind === "inherited" ? `inherited:${doc.path}` : doc.path,
    kind,
    path: doc.path,
    name: doc.name,
    folder: doc.folder,
    source: doc.source,
    tokens: doc.tokens,
    attached: kind === "attached",
    stale: false,
    unverified: false,
    ...extra,
  };
}

function fromPath(path: string, kind: ContextRow["kind"], extra: Partial<ContextRow>): ContextRow {
  const i = path.lastIndexOf("/");
  return {
    key: kind === "inherited" ? `inherited:${path}` : path,
    kind,
    path,
    name: i < 0 ? path : path.slice(i + 1),
    folder: i < 0 ? "" : path.slice(0, i),
    source: sourceOfPath(path),
    tokens: null,
    attached: kind === "attached",
    stale: false,
    unverified: false,
    ...extra,
  };
}

/**
 * Rows in display order (AC-14, AC-28): inherited (effective order) first, then
 * the agent's own attached paths in attached order, then every other doc grouped
 * specs/docs/insights/root/other, each by path. `docs === undefined` means discovery is
 * unavailable: attached rows stay visible as "unverified".
 */
export function buildRows(
  docs: ContextDoc[] | undefined,
  attachedPaths: string[],
  inherited: InheritedContextDoc[] = [],
): ContextRow[] {
  const byPath = new Map((docs ?? []).map((d) => [d.path, d] as const));
  const unverified = docs === undefined;
  const out: ContextRow[] = [];

  for (const inh of inherited) {
    const doc = byPath.get(inh.path);
    const extra = { viaSkill: inh.skill_name, unverified, stale: !unverified && !doc };
    out.push(doc ? fromDoc(doc, "inherited", extra) : fromPath(inh.path, "inherited", extra));
  }
  for (const path of attachedPaths) {
    const doc = byPath.get(path);
    out.push(
      doc
        ? fromDoc(doc, "attached")
        : fromPath(path, "attached", { stale: !unverified, unverified }),
    );
  }

  const taken = new Set([...inherited.map((i) => i.path), ...attachedPaths]);
  const rest = (docs ?? []).filter((d) => !taken.has(d.path));
  for (const source of SOURCE_ORDER) {
    rest
      .filter((d) => d.source === source)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .forEach((d) => out.push(fromDoc(d, "available")));
  }
  return out;
}

/** Case-insensitive match on file name or folder (AC-7). */
export function filterRows(rows: ContextRow[], text: string): ContextRow[] {
  const q = text.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q) || r.folder.toLowerCase().includes(q));
}

export interface FooterTotals {
  files: number;
  tokens: number;
  /** True only when tokens exceed the soft cap (AC-26). */
  overCap: boolean;
}

/** Totals over attached + inherited rows found on main, each path once (AC-12, AC-25, AC-28). */
export function footerTotals(rows: ContextRow[]): FooterTotals {
  const seen = new Set<string>();
  let tokens = 0;
  for (const r of rows) {
    if (r.kind === "available" || r.stale || r.unverified || r.tokens === null) continue;
    if (seen.has(r.path)) continue;
    seen.add(r.path);
    tokens += r.tokens;
  }
  return { files: seen.size, tokens, overCap: tokens > SOFT_CAP_TOKENS };
}

export interface SerializeGroup {
  source: ContextSource;
  heading: string;
  paths: string[];
}

/** Attached paths grouped under their source heading, attached order inside a group (AC-32). */
export function serializeAs(paths: string[]): SerializeGroup[] {
  return SOURCE_ORDER.map((source) => ({
    source,
    heading: SERIALIZE_HEADINGS[source],
    paths: paths.filter((p) => sourceOfPath(p) === source),
  })).filter((g) => g.paths.length > 0);
}

export function serializeAsText(groups: SerializeGroup[]): string {
  return groups.map((g) => [g.heading, ...g.paths.map((p) => `- ${p}`)].join("\n")).join("\n\n");
}

/** Immutable move; an out-of-range target leaves the order unchanged. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** New attached order after a drop, or null when the drop is not a valid reorder. */
export function reorderOnDrop(
  attached: string[],
  activeId: string,
  overId: string | undefined | null,
): string[] | null {
  if (!overId || activeId === overId) return null;
  const from = attached.indexOf(activeId);
  const to = attached.indexOf(overId);
  if (from < 0 || to < 0) return null;
  return moveItem(attached, from, to);
}
