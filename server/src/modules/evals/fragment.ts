import { EVAL_FRAGMENT_MAX_BYTES } from './constants.js';
import { normalizePath, normalizeRange } from './matching.js';

/**
 * Unified-diff hunk selection for eval cases. Walks the raw lines (no IO) and keeps each
 * hunk whole with its original `@@` header, so new-side line numbers stay those of the PR.
 */

interface Hunk {
  lines: string[];
  /** Inclusive new-side bounds covered by the hunk (context and added lines). */
  newStart: number;
  newEnd: number;
}

interface FileSection {
  path: string;
  header: string[];
  hunks: Hunk[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function sectionPath(lines: string[]): string {
  const plus = lines.find((l) => l.startsWith('+++ '));
  if (plus) {
    const p = plus.slice(4).replace(/^b\//, '').trim();
    if (p !== '/dev/null') return normalizePath(p);
  }
  const m = lines[0]?.match(/^diff --git a\/.* b\/(.*)$/);
  return m ? normalizePath(m[1]!.trim()) : '';
}

function parseSections(raw: string): FileSection[] {
  const lines = raw.split('\n');
  const chunks: string[][] = [];
  for (const line of lines) {
    if (line.startsWith('diff --git')) chunks.push([line]);
    else chunks.at(-1)?.push(line);
  }
  const sections: FileSection[] = [];
  for (const chunk of chunks) {
    const path = sectionPath(chunk);
    if (!path) continue;
    const header: string[] = [];
    const hunks: Hunk[] = [];
    let i = 0;
    while (i < chunk.length && !HUNK_RE.test(chunk[i]!)) header.push(chunk[i++]!);
    while (i < chunk.length) {
      const hh = chunk[i]!.match(HUNK_RE);
      if (!hh) {
        i++;
        continue;
      }
      let oldLeft = hh[2] === undefined ? 1 : Number(hh[2]);
      let newLeft = hh[4] === undefined ? 1 : Number(hh[4]);
      const newStart = Number(hh[3]);
      const hunkLines = [chunk[i++]!];
      while (i < chunk.length && (oldLeft > 0 || newLeft > 0 || chunk[i]!.startsWith('\\'))) {
        const l = chunk[i++]!;
        hunkLines.push(l);
        if (l.startsWith('\\')) continue;
        if (l.startsWith('+')) newLeft--;
        else if (l.startsWith('-')) oldLeft--;
        else {
          oldLeft--;
          newLeft--;
        }
      }
      hunks.push({ lines: hunkLines, newStart, newEnd: newStart + Number(hh[4] ?? 1) - 1 });
    }
    sections.push({ path, header, hunks });
  }
  return sections;
}

function intersecting(raw: string, file: string, start: number, end: number): { section: FileSection | null; hunks: Hunk[] } {
  const target = normalizePath(file);
  const [s, e] = normalizeRange(start, end);
  const section = parseSections(raw).find((x) => x.path === target) ?? null;
  const hunks = section ? section.hunks.filter((h) => h.newStart <= e && h.newEnd >= s && h.newEnd >= h.newStart) : [];
  return { section, hunks };
}

export type FragmentResult = { fragment: string } | { error: 'not_in_diff' | 'too_large' };

export function buildFragment(rawDiff: string, file: string, start: number, end: number): FragmentResult {
  const { section, hunks } = intersecting(rawDiff, file, start, end);
  if (!section || hunks.length === 0) return { error: 'not_in_diff' };
  const fragment = [...section.header, ...hunks.flatMap((h) => h.lines)].join('\n') + '\n';
  if (Buffer.byteLength(fragment, 'utf8') > EVAL_FRAGMENT_MAX_BYTES) return { error: 'too_large' };
  return { fragment };
}

export type FragmentCoverage = 'ok' | 'unparsable' | 'file_absent' | 'range_outside';

/** Classifies how a stored fragment relates to a case location (used by AC-14). */
export function inspectFragment(fragment: string, file: string, start: number, end: number): FragmentCoverage {
  const sections = parseSections(fragment);
  if (sections.length === 0 || sections.every((s) => s.hunks.length === 0)) return 'unparsable';
  const { section, hunks } = intersecting(fragment, file, start, end);
  if (!section) return 'file_absent';
  return hunks.length > 0 ? 'ok' : 'range_outside';
}

/** True when the fragment holds a hunk of `file` whose new-side lines intersect the range. */
export function fragmentCovers(fragment: string, file: string, start: number, end: number): boolean {
  return inspectFragment(fragment, file, start, end) === 'ok';
}
