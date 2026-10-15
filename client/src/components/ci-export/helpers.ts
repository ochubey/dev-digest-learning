import type { CiPostAs, CiRunStatus, CiTrigger } from "@devdigest/shared";
import { CI_TRIGGERS, CI_WORKFLOW_PATH, GITHUB_PREFIX, POST_AS_VALUES, RUN_STATUSES } from "./constants";

const NONE = "—";

/** The URL when it is an https://github.com/ link, otherwise null (AC-73, AC-80). */
export function safeGithubUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(GITHUB_PREFIX)) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "github.com" ? url : null;
  } catch {
    return null;
  }
}

/** Where the user adds the OPENROUTER_API_KEY secret (AC-41). */
export function secretsSettingsUrl(fullName: string): string {
  return `${GITHUB_PREFIX}${fullName}/settings/secrets/actions`;
}

export function isWorkflowPath(path: string): boolean {
  return path === CI_WORKFLOW_PATH;
}

/** Trigger a browser download of a base64-encoded zip (AC-46). */
export function downloadBase64Zip(b64: string, filename: string): void {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return NONE;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return NONE;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function formatCost(usd: number | null | undefined): string {
  return usd == null ? NONE : `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

const TIME = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Local date-time, "—" for null, the raw value when unparsable. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return NONE;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : TIME.format(d);
}

/** Keep only triggers the wizard knows (an installation stores whatever the server wrote). */
export function knownTriggers(values: readonly string[] | null | undefined): CiTrigger[] {
  return CI_TRIGGERS.filter((t) => values?.includes(t));
}

export function knownPostAs(value: string | null | undefined): CiPostAs | undefined {
  return POST_AS_VALUES.find((v) => v === value);
}

/** The run status when the UI knows it (a stored value may be anything), otherwise undefined. */
export function knownRunStatus(value: string | null | undefined): CiRunStatus | undefined {
  return RUN_STATUSES.find((v) => v === value);
}
