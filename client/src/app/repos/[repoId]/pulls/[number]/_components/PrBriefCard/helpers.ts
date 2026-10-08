import type { BlastRadius, BriefMissingInput, Intent, PrBrief, ReviewFocusItem } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { GENERIC_RISK_ICON, KNOWN_RISK_KINDS, MAX_BLAST_CALLERS, RISK_KIND_ICON } from "./constants";

export { getRetryAfterSeconds } from "../IntentBlock/helpers";

/** Localized names of the inputs the brief was generated without, in canonical order. */
export function missingLabels(
  missing: readonly BriefMissingInput[],
  label: (input: BriefMissingInput) => string,
): string[] {
  return missing.map(label);
}

export function isInDiff(path: string, diffPaths: ReadonlySet<string>): boolean {
  return diffPaths.has(path);
}

/** `file:line` locator of a review-focus item. */
export function focusLabel(item: Pick<ReviewFocusItem, "file" | "line">): string {
  return `${item.file}:${item.line}`;
}

export function riskKindIcon(kind: string): IconName {
  return Object.hasOwn(RISK_KIND_ICON, kind) ? RISK_KIND_ICON[kind]! : GENERIC_RISK_ICON;
}

/** Message key (in the `brief` namespace) naming a risk kind; unknown kinds use `riskKind.unknown`. */
export function riskKindLabelKey(kind: string): `riskKind.${string}` {
  return KNOWN_RISK_KINDS.includes(kind) ? `riskKind.${kind}` : "riskKind.unknown";
}

const sortedUnique = (xs: readonly string[]) => [...new Set(xs)].sort();
const sameSet = (a: readonly string[], b: readonly string[]) => {
  const x = sortedUnique(a);
  const y = sortedUnique(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const isSubset = (a: readonly string[], b: readonly string[]) => {
  const set = new Set(b);
  return a.every((v) => set.has(v));
};
/** Snapshot callers are truncated to MAX_BLAST_CALLERS: a full snapshot only has to be a subset. */
const sameCallers = (snapshot: readonly string[], live: readonly string[]) => {
  const snap = sortedUnique(snapshot);
  return (
    isSubset(snap, live) && (snap.length >= MAX_BLAST_CALLERS || isSubset(sortedUnique(live), snap))
  );
};
const callerFiles = (b: BlastRadius) => b.downstream.flatMap((d) => d.callers.map((c) => c.file));

/**
 * Advisory check (D-2): did the live Intent / Blast Radius move since the brief snapshotted them?
 * Compares presence, summary, in/out-of-scope items (Intent) and the caller-file SET (Blast);
 * order and duplicates are ignored. A snapshot holding MAX_BLAST_CALLERS callers is truncated,
 * so it only has to be a subset of the live callers. `null`/`undefined` both mean "absent".
 */
export function inputsChanged(
  brief: Pick<PrBrief, "intent" | "blast">,
  liveIntent: Intent | null | undefined,
  liveBlast: BlastRadius | null | undefined,
): boolean {
  const si = brief.intent;
  if (!!si !== !!liveIntent) return true;
  if (si && liveIntent) {
    if (
      si.summary !== liveIntent.summary ||
      !sameSet(si.in_scope, liveIntent.in_scope) ||
      !sameSet(si.out_of_scope, liveIntent.out_of_scope)
    ) {
      return true;
    }
  }
  const sb = brief.blast;
  if (!!sb !== !!liveBlast) return true;
  if (sb && liveBlast) {
    if (sb.summary !== liveBlast.summary || !sameCallers(callerFiles(sb), callerFiles(liveBlast))) return true;
  }
  return false;
}

/** Server-supplied text of a failed generate (502 only; the server text is fixed and safe),
 *  or null to fall back to the generic `card.generateError`. */
export function generateErrorMessage(error: Error): string | null {
  return error instanceof ApiError && error.status === 502 && error.message ? error.message : null;
}
