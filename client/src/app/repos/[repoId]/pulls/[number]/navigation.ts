/* URL state for the PR detail page: tab, trace and the Files-changed deep link
   (?tab=diff&file=<path>&line=<n>). All writes use router.replace so deep links
   never pollute the history stack. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

export interface DiffTarget {
  file: string;
  /** Null when the `line` param is missing or invalid: the file is still targeted. */
  line: number | null;
}

/** Pure: current query string + updates (null removes) -> page href. */
export function buildPrHref(
  repoId: string,
  number: string,
  currentQuery: string,
  updates: Record<string, string | null>,
): string {
  const entries = new Map<string, string>();
  for (const [k, v] of new URLSearchParams(currentQuery)) entries.set(k, v);
  for (const [k, v] of Object.entries(updates)) {
    if (v == null) entries.delete(k);
    else entries.set(k, v);
  }
  const qs = [...entries].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return `/repos/${repoId}/pulls/${number}${qs ? `?${qs}` : ""}`;
}

/** A repo-relative path only: no control characters, not absolute, no `..` segment. */
function isSafeFile(file: string): boolean {
  if (!file || /[\x00-\x1f\x7f]/.test(file)) return false;
  if (file.startsWith("/") || file.startsWith("\\") || /^[A-Za-z]:/.test(file)) return false;
  return !file.split(/[\\/]/).some((seg) => seg === "..");
}

function parseTarget(file: string | null, line: string | null): DiffTarget | null {
  if (file == null || !isSafeFile(file)) return null;
  const n = line != null && /^[1-9]\d*$/.test(line) ? Number(line) : null;
  return { file, line: n != null && Number.isSafeInteger(n) ? n : null };
}

export function usePrNavigation() {
  const params = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { repoId, number } = params;
  const query = search.toString();

  const tab = search.get("tab") ?? "overview";
  const fileParam = search.get("file");
  const lineParam = search.get("line");
  const target = React.useMemo(() => parseTarget(fileParam, lineParam), [fileParam, lineParam]);

  const go = (updates: Record<string, string | null>) =>
    router.replace(buildPrHref(repoId, number, query, updates));

  return {
    tab,
    target,
    setParam: (key: string, val: string | null) => go({ [key]: val }),
    setTab: (t: string) => go({ tab: t, file: null, line: null }),
    openInDiff: (file: string, line?: number | null) =>
      go({ tab: "diff", file, line: line != null ? String(line) : null }),
  };
}
