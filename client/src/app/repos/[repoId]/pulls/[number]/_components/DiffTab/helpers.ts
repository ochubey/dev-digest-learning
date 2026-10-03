import type { FindingRecord, PrFile, SmartDiff, SmartDiffRole } from "@devdigest/shared";
import { filesWithFindings } from "@/lib/latest-findings";

export interface FileGroup {
  role: SmartDiffRole;
  files: PrFile[];
  /** Number of files in the group that have findings. */
  findingFiles: number;
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
    groups.push({ role: g.role, files: out, findingFiles });
  }

  const missing = files.filter((f) => !seen.has(f.path));
  if (missing.length > 0) {
    const core = groups.find((g) => g.role === "core");
    const extra = missing.filter((f) => withFindings.has(f.path)).length;
    if (core) {
      core.files.push(...missing);
      core.findingFiles += extra;
    } else groups.unshift({ role: "core", files: missing, findingFiles: extra });
  }

  return groups.filter((g) => g.files.length > 0);
}
