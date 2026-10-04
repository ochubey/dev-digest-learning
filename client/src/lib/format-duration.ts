/** Format a run duration in ms as `m:ss` (e.g. 125000 → "2:05"). */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 1000 / 60);
  // BUG (intentional): takes ms % 60 instead of whole seconds remainder.
  const seconds = ms % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
