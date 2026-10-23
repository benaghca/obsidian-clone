// Read-only projection: the original JSON is never serialized or saved.
export interface CanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  subpath?: string;
  url?: string;
  label?: string;
  color?: string;
}
export type Side = "top" | "right" | "bottom" | "left";
export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: Side;
  toSide?: Side;
  fromEnd?: "none" | "arrow";
  toEnd?: "none" | "arrow";
  color?: string;
  label?: string;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown, fallback: number) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
export function readCanvas(text: string): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!record(data)) return { nodes: [], edges: [] };
  const nodes: CanvasNode[] = [];
  for (const n of Array.isArray(data.nodes) ? data.nodes : []) {
    if (!record(n) || typeof n.id !== "string" || !["text", "file", "link", "group"].includes(String(n.type))) continue;
    const node: CanvasNode = { id: n.id, type: n.type as CanvasNode["type"], x: finite(n.x, 0), y: finite(n.y, 0), width: Math.max(1, finite(n.width, 250)), height: Math.max(1, finite(n.height, 200)) };
    for (const key of ["text", "file", "subpath", "url", "label", "color"] as const) if (typeof n[key] === "string") node[key] = n[key];
    nodes.push(node);
  }
  const ids = new Set(nodes.map(n => n.id));
  const edges = (Array.isArray(data.edges) ? data.edges : []).filter(e => record(e) && typeof e.id === "string" && ids.has(e.fromNode as string) && ids.has(e.toNode as string)) as CanvasEdge[];
  return { nodes, edges };
}
const vectors: Record<Side, [number, number]> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
const sideOf = (s: unknown, fallback: Side): Side => typeof s === "string" && Object.hasOwn(vectors, s) ? s as Side : fallback;
export function edgeCurve(a: CanvasNode, b: CanvasNode, edge: CanvasEdge) {
  const dx = b.x + b.width / 2 - a.x - a.width / 2, dy = b.y + b.height / 2 - a.y - a.height / 2;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const from = sideOf(edge.fromSide, horizontal ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top");
  const to = sideOf(edge.toSide, horizontal ? dx >= 0 ? "left" : "right" : dy >= 0 ? "top" : "bottom");
  const anchor = (n: CanvasNode, side: Side) => [n.x + (side === "left" ? 0 : side === "right" ? n.width : n.width / 2), n.y + (side === "top" ? 0 : side === "bottom" ? n.height : n.height / 2)];
  const p = anchor(a, from), q = anchor(b, to), u = vectors[from], v = vectors[to];
  const start = [p[0] + u[0] * 7, p[1] + u[1] * 7], end = [q[0] + v[0] * 7, q[1] + v[1] * 7];
  const bend = Math.max(50, Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1])) / 2);
  const c = [start[0] + u[0] * bend, start[1] + u[1] * bend], d = [end[0] + v[0] * bend, end[1] + v[1] * bend];
  return { path: `M${p} L${start} M${start} C${c} ${d} ${end} M${end} L${q}`, x: (start[0] + 3 * c[0] + 3 * d[0] + end[0]) / 8, y: (start[1] + 3 * c[1] + 3 * d[1] + end[1]) / 8 };
}
