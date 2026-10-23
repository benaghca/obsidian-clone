import type { CanvasNode } from "./model";

// Keep raw records separate from the tolerant rendering projection. Only the
// card fields actually edited are patched; unknown records/keys retain their order.
export function editCanvas(source: string, changed: CanvasNode[], deleted = new Set<string>(), added: CanvasNode[] = []) {
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
    }
    return n;
  });
  if (deleted.size && Array.isArray(data.edges)) data.edges = data.edges.filter((e: { fromNode?: string; toNode?: string } | null) => !e || !deleted.has(e.fromNode!) && !deleted.has(e.toNode!));
  if (added.length) {
    if (!Array.isArray(data.nodes)) data.nodes = [];
    data.nodes.push(...added);
    if (!("edges" in data)) data.edges = [];
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
