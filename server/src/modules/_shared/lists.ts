/** True when both lists have the same items in the same order. */
export function sameOrderedList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}
