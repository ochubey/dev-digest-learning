import type { DownstreamImpact } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";

const KNOWN_REASONS = [
  "no_data",
  "flag_off",
  "index_failed",
  "index_partial",
  "repo_too_large",
] as const;

/** Message key (under `degraded.`) for a repo-intel degraded reason; unknown -> generic. */
export function degradedReasonKey(reason: string | null | undefined): string {
  return (KNOWN_REASONS as readonly string[]).includes(reason ?? "") ? (reason as string) : "unknown";
}

/** Totals for the summary row. Endpoints/crons are unioned across symbols. */
export function blastCounts(symbolCount: number, downstream: DownstreamImpact[]) {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;
  for (const d of downstream) {
    callers += d.callers.length;
    d.endpoints_affected.forEach((e) => endpoints.add(e));
    d.crons_affected.forEach((c) => crons.add(c));
  }
  return { symbols: symbolCount, callers, endpoints: endpoints.size, crons: crons.size };
}

/** GitHub blob link at the PR head sha, or null when repo/sha are unknown. */
export function callerHref(
  repoFullName: string | null | undefined,
  headSha: string | null | undefined,
  file: string,
  line: number,
): string | null {
  if (!repoFullName || !headSha) return null;
  return githubBlobUrl(repoFullName, headSha, file, line);
}
