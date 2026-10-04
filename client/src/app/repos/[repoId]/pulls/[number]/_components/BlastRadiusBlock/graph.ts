import type { DownstreamImpact } from "@devdigest/shared";
import { GRAPH } from "./constants";

export type GraphNodeKind = "symbol" | "caller" | "endpoint" | "cron";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  /** Full text (shown in <title>); the SVG renders `truncate(label)`. */
  label: string;
  x: number;
  y: number;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

const COLUMN: Record<GraphNodeKind, 0 | 1 | 2> = { symbol: 0, caller: 1, endpoint: 2, cron: 2 };

export function truncate(text: string, max: number = GRAPH.maxChars): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Three columns: changed symbols -> callers -> endpoints/crons. A caller is shared across
 * symbols it reaches. Endpoints/crons are attributed to a symbol's callers as a group (the
 * contract has no per-caller facts), so each of the group's callers links to each of them.
 * Returns null when there is nothing downstream to draw.
 */
export function layoutGraph(downstream: DownstreamImpact[]): GraphLayout | null {
  const nodes = new Map<string, Omit<GraphNode, "x" | "y">>();
  const edges = new Map<string, GraphEdge>();

  const addNode = (id: string, kind: GraphNodeKind, label: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label });
    return id;
  };
  const addEdge = (from: string, to: string) => edges.set(`${from}>${to}`, { from, to });

  for (const d of downstream) {
    if (d.callers.length === 0 && d.endpoints_affected.length === 0 && d.crons_affected.length === 0) {
      continue;
    }
    const sym = addNode(`s:${d.symbol}`, "symbol", d.symbol);
    const callerIds = d.callers.map((c) => addNode(`c:${c.file}:${c.name}`, "caller", c.name));
    const targets = [
      ...d.endpoints_affected.map((e) => addNode(`e:${e}`, "endpoint", e)),
      ...d.crons_affected.map((c) => addNode(`k:${c}`, "cron", c)),
    ];
    for (const c of callerIds) addEdge(sym, c);
    if (callerIds.length === 0) for (const t of targets) addEdge(sym, t);
    else for (const c of callerIds) for (const t of targets) addEdge(c, t);
  }

  if (nodes.size === 0) return null;

  const { nodeW, nodeH, rowGap, colGap, pad } = GRAPH;
  const cols: Omit<GraphNode, "x" | "y">[][] = [[], [], []];
  for (const n of nodes.values()) cols[COLUMN[n.kind]]!.push(n);

  const colHeight = (n: number) => (n === 0 ? 0 : n * nodeH + (n - 1) * rowGap);
  const innerH = Math.max(...cols.map((c) => colHeight(c.length)));
  const placed: GraphNode[] = [];
  cols.forEach((col, ci) => {
    const offset = (innerH - colHeight(col.length)) / 2;
    col.forEach((n, ri) =>
      placed.push({ ...n, x: pad + ci * (nodeW + colGap), y: pad + offset + ri * (nodeH + rowGap) }),
    );
  });

  return {
    nodes: placed,
    edges: [...edges.values()],
    width: pad * 2 + 3 * nodeW + 2 * colGap,
    height: pad * 2 + innerH,
  };
}
