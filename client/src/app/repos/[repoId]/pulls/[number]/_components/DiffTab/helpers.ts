import type { FindingRecord, PrFile, SmartDiff, SmartDiffRole } from "@devdigest/shared";
import { filesWithFindings } from "@/lib/latest-findings";
import { ROLE_ORDER } from "./constants";

export interface FileGroup {
  role: SmartDiffRole;
  files: PrFile[];
  /** Number of files in the group that have findings. */
  findingFiles: number;
  /** Findings in the group's files by display severity (can exceed the file count). */
  findingCounts: SeverityCounts;
}

export interface SeverityCounts {
  CRITICAL: number;
  WARNING: number;
  SUGGESTION: number;
}

export const emptyCounts = (): SeverityCounts => ({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });

/** Count findings per display bucket (anything but CRITICAL/WARNING counts as SUGGESTION). */
export function countBySeverity(findings: readonly FindingRecord[]): SeverityCounts {
  const out = emptyCounts();
  for (const f of findings) out[f.severity === "CRITICAL" || f.severity === "WARNING" ? f.severity : "SUGGESTION"]++;
  return out;
}

/** Every role in display order; roles without files get an empty group (shown disabled). */
export function withEmptyRoles(groups: readonly FileGroup[]): FileGroup[] {
  return ROLE_ORDER.map(
    (role) =>
      groups.find((g) => g.role === role) ?? { role, files: [], findingFiles: 0, findingCounts: emptyCounts() },
  );
}

/** Join PR files (with patches) to smart-diff entries by path. The group order and
   the order inside a group are the server's (the client never re-sorts). Files
   absent from the response fall into `core`: appended to the response's core group,
   or, when it has none, a new core group inserted at the FRONT (core is first in
   the contract order). Response entries without a PR file are ignored; empty
   groups are dropped. `findingFiles` counts files that have a finding in
   `visibleFindings` (the list from lib/latest-findings.ts), the same list that
   drives the file dots, never the server's `finding_lines`. */
export function groupFiles(
  files: readonly PrFile[],
  smartDiff: SmartDiff,
  visibleFindings: readonly FindingRecord[] = [],
): FileGroup[] {
  const withFindings = filesWithFindings(visibleFindings);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const seen = new Set<string>();
  const groups: FileGroup[] = [];

  for (const g of smartDiff.groups) {
    const out: PrFile[] = [];
    let findingFiles = 0;
    for (const sf of g.files) {
      const f = byPath.get(sf.path);
      if (!f || seen.has(sf.path)) continue;
      seen.add(sf.path);
      out.push(f);
      if (withFindings.has(sf.path)) findingFiles++;
    }
    groups.push({ role: g.role, files: out, findingFiles, findingCounts: emptyCounts() });
  }

  const missing = files.filter((f) => !seen.has(f.path));
  if (missing.length > 0) {
    const core = groups.find((g) => g.role === "core");
    const extra = missing.filter((f) => withFindings.has(f.path)).length;
    if (core) {
      core.files.push(...missing);
      core.findingFiles += extra;
    } else groups.unshift({ role: "core", files: missing, findingFiles: extra, findingCounts: emptyCounts() });
  }

  for (const g of groups) {
    const paths = new Set(g.files.map((f) => f.path));
    g.findingCounts = countBySeverity(visibleFindings.filter((f) => paths.has(f.file)));
  }
  return groups.filter((g) => g.files.length > 0);
}
