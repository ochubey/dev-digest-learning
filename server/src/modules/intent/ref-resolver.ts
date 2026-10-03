import type { GitHubClient } from '../../vendor/shared/adapters.js';
import type { RepoRef } from '@devdigest/shared';

const MAX_DOC_SIZE = 65536; // 64 KB: hard cap applied to anything fetched
const TRUNCATE_THRESHOLD = 32768; // 32 KB: documents above this are shortened to fit it
const TAIL_KEEP = 1024; // 1 KB of the end is kept after the head (plan: "last 1 KB")
const TRUNCATION_MARKER = '\n\n[... truncated ...]\n\n';

export type SourceStatus = 'fetched' | 'unavailable' | 'error';

export interface ResolvedSource {
  label: string;
  status: SourceStatus;
}

export interface RefResolverResult {
  linkedIssue?: {
    number: number;
    title: string;
    body: string;
  };
  planDoc?: {
    path: string;
    content: string;
  };
  specDoc?: {
    path: string;
    content: string;
  };
  /**
   * Status per REFERENCED source only (nothing is claimed about sources the PR never
   * mentioned): `linked_issue`, `plan_at_<path>`, `spec_at_<path>`, `issue_<o>/<r>#<n>`.
   * Statuses are code-owned: `fetched`, `unavailable` (not found / not same repo), `error`
   * (auth, rate limit, network, timeout).
   */
  sourceStatuses: Record<string, SourceStatus>;
  /** Same data as `sourceStatuses`, with human labels, in resolution order. */
  sources: ResolvedSource[];
}

export interface IssueRefMatch {
  /** Same-repo issue number (first match by precedence), if any. */
  number?: number;
  /**
   * True when the number came from a keyword form (fixes/closes/resolves/issue #N) or a full
   * URL / owner/repo#N; false for a bare `#N` (implicit reference, may just be prose).
   */
  explicit?: boolean;
  /** Issues in OTHER repositories that were referenced (ignored, never fetched). */
  crossRepo: string[];
}

// Qualified refs: groups 1-3 full URL, 4-6 `owner/repo#N`. Lookbehinds keep anchors inside
// URLs (`.../pull/3#5`, `site/p#12`) from being read as references.
const QUALIFIED =
  String.raw`(?:https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)` +
  String.raw`|(?<![\w./-])([\w.-]+)\/([\w.-]+)#(\d+))`;
// A bare `#N` is only an IMPLICIT reference. `PR #N` / `pull request #N` name a pull request
// (often a demo or unrelated number), never the linked issue, so they are not matched at all.
const BARE = String.raw`(?<![\w/.&-])(?<!\b(?:PRs?|pull(?: requests?)?)\s{0,2})#(\d+)\b`;
const KEYWORD = String.raw`\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|issues?)\s*:?\s*`;
// Precedence tiers: keyword form (qualified or bare) > qualified > bare #N.
// Group indexes: 0-5 = qualified groups, 6 = bare number (keyword tier only has both).
const TIERS: RegExp[] = [
  new RegExp(`${KEYWORD}(?:${QUALIFIED}|${BARE})`, 'gi'),
  new RegExp(QUALIFIED, 'gi'),
  new RegExp(BARE, 'gi'),
];

function sameRepo(repo: RepoRef, owner: string, name: string): boolean {
  return owner.toLowerCase() === repo.owner.toLowerCase() && name.toLowerCase() === repo.name.toLowerCase();
}

/**
 * Find the linked issue in the PR body and title. Deterministic precedence: tiers in order
 * (keyword > full URL / owner/repo#N > bare #N); within a tier the body is scanned before the
 * title and the first same-repo match wins. Other-repo references are collected, not fetched.
 */
export function extractIssueRef(repo: RepoRef, title: string, body: string): IssueRefMatch {
  const cross: string[] = [];
  const texts = [body, title];
  let found: number | undefined;
  let explicit = false;
  for (let i = 0; i < TIERS.length; i++) {
    for (const text of texts) {
      for (const m of text.matchAll(TIERS[i]!)) {
        const g = m.slice(1);
        // bare-only tier has a single group (the number)
        const bare = i === 2 ? g[0] : g[6];
        if (bare) {
          if (found === undefined) {
            found = Number(bare);
            explicit = i < 2; // keyword tier (0) is explicit; the bare-only tier (2) is not
          }
          continue;
        }
        const owner = g[0] ?? g[3];
        const name = g[1] ?? g[4];
        const n = g[2] ?? g[5];
        if (!owner || !name || !n) continue;
        if (sameRepo(repo, owner, name)) {
          if (found === undefined) {
            found = Number(n);
            explicit = true; // full URL / owner/repo#N is always explicit
          }
          continue;
        }
        const ref = `${owner}/${name}#${n}`;
        if (!cross.includes(ref) && cross.length < 3) cross.push(ref);
      }
    }
  }
  // other-repo refs are collected from every tier (even after a same-repo hit) so they get marked
  return found === undefined ? { crossRepo: cross } : { number: found, explicit, crossRepo: cross };
}

// A whole path token ending in .md. The lookbehind stops a token from starting in the middle of a
// longer path or URL, so `server/docs/architecture.md` is never cut down to `docs/architecture.md`.
const MD_PATH = /(?<![\w./-])(?:[\w.-]+\/)*[\w.-]+\.md(?![\w-])/gi;

/** Plan/spec candidates: a path under a `docs/` folder, or a file named `*spec.md` / `*plan.md`. */
function isDocCandidate(path: string): boolean {
  return /(^|\/)docs\//i.test(path) || /(?:spec|plan)\.md$/i.test(path);
}

/** Full repo-relative doc paths mentioned in `text`, in order of appearance, deduplicated. */
export function extractDocPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MD_PATH)) {
    const path = m[0].replace(/^\.\//, '');
    if (isDocCandidate(path) && !out.includes(path)) out.push(path);
  }
  return out;
}

function isNotFound(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 404 || status === 410;
}

export class RefResolver {
  constructor(private github: GitHubClient) {}

  async resolveRefs(
    repo: RepoRef,
    title: string,
    body: string,
    headSha: string,
  ): Promise<RefResolverResult> {
    const statuses: Record<string, SourceStatus> = {};
    const sources: ResolvedSource[] = [];
    const result: RefResolverResult = { sourceStatuses: statuses, sources };
    const record = (key: string, label: string, status: SourceStatus) => {
      statuses[key] = status;
      sources.push({ label, status });
    };

    // Linked issue: PR body + title, same repo only (other repos are marked, never fetched)
    const ref = extractIssueRef(repo, title, body);
    if (ref.number !== undefined) {
      const label = `Linked issue #${ref.number}`;
      try {
        const issue = await this.github.getIssue(repo, ref.number);
        if (issue) {
          result.linkedIssue = {
            number: ref.number,
            title: issue.title,
            body: this.truncateDoc(issue.body || ''),
          };
          record('linked_issue', label, 'fetched');
        } else if (ref.explicit) {
          record('linked_issue', label, 'unavailable');
        } // implicit bare #N that does not resolve: silently dropped (it was probably prose)
      } catch (err) {
        // 404/410 = the issue does not exist (or is hidden): unavailable for an explicit
        // reference, silently dropped for an implicit bare #N; anything else = error
        if (isNotFound(err)) {
          if (ref.explicit) record('linked_issue', label, 'unavailable');
        } else {
          record('linked_issue', label, 'error');
        }
      }
    }
    for (const x of ref.crossRepo) {
      record(`issue_${x}`, `Issue ${x} (other repository)`, 'unavailable');
    }

    // Plan/spec paths from the PR body: take the FULL path token first, then classify it
    const foundDocs = new Set(extractDocPaths(body));

    // Try to fetch the first matching spec/plan document
    for (const docPath of foundDocs) {
      if (result.planDoc || result.specDoc) break;

      const isSpecPath = docPath.toLowerCase().includes('spec');
      const kind = isSpecPath ? 'spec' : 'plan';
      const key = `${kind}_at_${docPath}`;
      const label = `${isSpecPath ? 'Spec' : 'Plan'} at ${docPath}`;
      try {
        // null = not found (adapter maps 404 to null); other failures throw
        const content = await this.github.readRepoFile(repo, docPath, headSha);

        if (content) {
          const truncated = this.truncateDoc(content);
          if (isSpecPath) result.specDoc = { path: docPath, content: truncated };
          else result.planDoc = { path: docPath, content: truncated };
          record(key, label, 'fetched');
        } else {
          record(key, label, 'unavailable');
        }
      } catch {
        record(key, label, 'error');
      }
    }

    return result;
  }

  /**
   * <= 32 KB: untouched. Larger: hard-capped at 64 KB first, then reduced to 32 KB as
   * head + marker + last 1 KB, so the beginning of the doc (where the goal/scope lives)
   * is preserved.
   */
  truncateDoc(content: string): string {
    if (content.length <= TRUNCATE_THRESHOLD) return content;

    const capped = content.length > MAX_DOC_SIZE ? content.slice(0, MAX_DOC_SIZE) : content;
    const tail = content.length > MAX_DOC_SIZE ? '' : capped.slice(-TAIL_KEEP);
    const headLen = TRUNCATE_THRESHOLD - TAIL_KEEP - TRUNCATION_MARKER.length;
    return capped.slice(0, headLen) + TRUNCATION_MARKER + tail;
  }
}
