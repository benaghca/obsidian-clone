import type { CanvasEdge, CanvasNode } from "./model";

// Keep raw records separate from the tolerant rendering projection. Only the
// fields actually edited are patched; unknown records/keys retain their order.
export function editCanvas(source: string, changed: CanvasNode[], deleted = new Set<string>(), added: CanvasNode[] = [], edges: CanvasEdge[] = [], deletedEdges = new Set<string>()) {
  let data;
  try { data = JSON.parse(source); } catch { data = {}; }
  if (!data || typeof data !== "object" || Array.isArray(data)) data = {};
  const changes = new Map(changed.map(n => [n.id, n]));
  if (Array.isArray(data.nodes)) data.nodes = data.nodes.filter((n: CanvasNode | null) => !n || !deleted.has(n.id)).map((n: CanvasNode | null) => {
    const next = n && changes.get(n.id);
    if (next) {
      for (const key of ["x", "y", "width", "height"] as const) if (n[key] !== next[key]) n[key] = next[key];
      if ("color" in next && n.color !== next.color) { if (next.color === undefined) delete n.color; else n.color = next.color; }
      if (typeof next.text === "string" && n.text !== next.text) n.text = next.text;
      if (n.type === "group" && "label" in next) { if (next.label) n.label = next.label; else delete n.label; }
    }
    return n;
  });
  if ((deleted.size || deletedEdges.size) && Array.isArray(data.edges)) data.edges = data.edges.filter((e: CanvasEdge | null) => !e || !deletedEdges.has(e.id) && !deleted.has(e.fromNode) && !deleted.has(e.toNode));
  if (added.length) {
    if (!Array.isArray(data.nodes)) data.nodes = [];
    data.nodes.unshift(...added.filter(n => n.type === "group"));
    data.nodes.push(...added.filter(n => n.type !== "group"));
    if (!("edges" in data)) data.edges = [];
  }
  if (edges.length) {
    if (!Array.isArray(data.edges)) data.edges = [];
    for (const edge of edges) {
      const index = data.edges.findIndex((e: CanvasEdge | null) => e?.id === edge.id);
      if (index < 0) { data.edges.push(edge); continue; }
      let old = data.edges[index];
      const keys = ["fromNode", "fromSide", "toNode", "toSide", "fromEnd", "toEnd", "color", "label"] as const;
      for (const key of keys) if (key in edge) {
        const value = edge[key];
        if (value === undefined || key === "label" && value === "") delete old[key];
        else if (key in old) old[key] = value;
        else {
          // Insert new native fields in native order without moving old keys.
          const entries = Object.entries(old), before = entries.findIndex(([k]) => keys.indexOf(k as typeof key) > keys.indexOf(key));
          entries.splice(before < 0 ? entries.length : before, 0, [key, value]);
          old = Object.fromEntries(entries);
        }
      }
      data.edges[index] = old;
    }
  }
  return format(data);
}
// Obsidian's tab-indented JSON: flat records on one line, nested records
// expanded, compact scalar arrays, and no trailing newline.
function format(value: unknown, depth = 0, key = ""): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value), array = Array.isArray(value);
  if (!entries.length || (depth > 1 || array && key !== "nodes" && key !== "edges") && entries.every(([, v]) => !v || typeof v !== "object")) return JSON.stringify(value);
  const indent = "\t".repeat(depth + 1);
  return (array ? "[" : "{") + "\n" + entries.map(([k, v]) => indent + (array ? "" : JSON.stringify(k) + ":") + format(v, depth + 1, k)).join(",\n") + "\n" + "\t".repeat(depth) + (array ? "]" : "}");
}
