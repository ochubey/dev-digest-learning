import { MIN_FILES_FOR_EMPTY_GRAPH_CHECK } from '../constants.js';

/**
 * A repo with many source files always has some local imports. Zero edges there means the
 * graph step silently produced nothing (e.g. a path-format mismatch), which would leave
 * `decl_file` unresolved and the blast radius showing "no callers" on a "full" index.
 * Returns a `graphFailed` reason, or undefined when the graph looks plausible.
 */
export function emptyGraphReason(edgeCount: number, fileCount: number): string | undefined {
  if (edgeCount > 0 || fileCount < MIN_FILES_FOR_EMPTY_GRAPH_CHECK) return undefined;
  return `empty import graph: 0 edges across ${fileCount} files`;
}
