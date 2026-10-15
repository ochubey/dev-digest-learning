import type { CiTrigger } from "@devdigest/shared";
import { CI_TRIGGERS } from "../constants";

/** Selected triggers in the canonical order of CI_TRIGGERS. */
export function sortTriggers(selected: readonly string[]): CiTrigger[] {
  return CI_TRIGGERS.filter((t) => selected.includes(t));
}

export function sameConfig(
  a: { triggers: readonly string[]; postAs: string },
  b: { triggers: readonly string[]; postAs: string },
): boolean {
  return a.postAs === b.postAs && sortTriggers(a.triggers).join() === sortTriggers(b.triggers).join();
}
