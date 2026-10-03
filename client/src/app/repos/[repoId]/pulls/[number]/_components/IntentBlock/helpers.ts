import type { IntentSource } from "@devdigest/shared";
import { ApiError } from "@/lib/api";

/** Seconds to wait when the derive call was rate limited (429), otherwise null. */
export function getRetryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const v = (error.details as { retry_after?: unknown } | undefined)?.retry_after;
  return typeof v === "number" && v > 0 ? Math.ceil(v) : 1;
}

/**
 * i18n key (under `intent.`) explaining why a source is not `fetched`, or null when it was.
 * Derived from status + label, because the stored source only carries those two fields:
 * `unavailable` = the file / issue does not exist at the PR head commit (or it points to
 * another repository, which is never fetched); `error` = the request failed.
 */
export function getSourceReasonKey(
  source: IntentSource,
): "reasonNotFound" | "reasonOtherRepo" | "reasonError" | null {
  if (source.status === "fetched") return null;
  if (source.status === "error") return "reasonError";
  return /\(other repository\)\s*$/i.test(source.label) ? "reasonOtherRepo" : "reasonNotFound";
}

export function getSourceIcon(status: IntentSource["status"]) {
  switch (status) {
    case "fetched":
      return "CheckCircle";
    case "unavailable":
      return "AlertTriangle";
    case "error":
      return "AlertOctagon";
    default:
      return undefined;
  }
}

export function getSourceColor(status: IntentSource["status"]) {
  switch (status) {
    case "fetched":
      return "var(--ok)";
    case "unavailable":
      return "var(--warn)";
    case "error":
      return "var(--crit)";
    default:
      return "var(--text-secondary)";
  }
}
