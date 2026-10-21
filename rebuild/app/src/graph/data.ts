// The graph view's model: which nodes and links to draw, worked out from the
// vault's file list and link index (and tags, when they are shown). Nodes are
// notes; links are resolved wikilinks and markdown links, drawn undirected
// but remembering which way they point (for arrows). Options add tags,
// attachments and links to notes that don't exist yet, hide orphans, filter
// by a search, or keep only the neighbourhood of one note (the local graph).
// Pure and free of the DOM, so it is tested on its own.

import type { LinkIndex } from "../api";

export type NodeKind = "note" | "attachment" | "tag" | "unresolved";

export interface GraphNode {
  /** Stable across rebuilds: a file's path, "#tag" for a tag, "?name" for a missing note. */
  id: string;
  label: string;
  kind: NodeKind;
  /** The file it stands for (notes and attachments). */
  path?: string;
  /** Links in and out in the graph as drawn; bigger nodes have more. */
  weight: number;
}

export interface GraphLink {
  source: number;
  target: number;
  /** It points both ways (each note links to the other). */
  both: boolean;
}

export interface GraphModel {
  nodes: GraphNode[];
  links: GraphLink[];
  /** Node index by id. */
  index: Map<string, number>;
}

export interface GraphSource {
  /** Every note path in the vault (excluded files already left out). */
  notes: readonly string[];
  /** Every other file (attachments), excluded files already left out. */
  attachments: readonly string[];
  links: LinkIndex;
  /** Tags per note (only needed when tags are shown). */
  tags?: ReadonlyMap<string, readonly string[]>;
}

export interface LocalOptions {
  /** The note in the middle. */
  center: string;
  /** How many links away to go (1 to 5). */
  depth: number;
  /** Follow links into the notes reached (backlinks). */
  incoming: boolean;
  /** Follow links out of them. */
  outgoing: boolean;
  /** Also draw links between notes that aren't on a path from the middle. */
  neighbors: boolean;
}

export interface GraphOptions {
  showTags: boolean;
  showAttachments: boolean;
  /** "Existing files only": leave out links to notes that don't exist. */
  hideUnresolved: boolean;
  showOrphans: boolean;
  /** The search filter: notes and attachments it rejects are left out. */
  include?: (path: string) => boolean;
  local?: LocalOptions;
}

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const tagId = (tag: string) => `#${tag.toLowerCase()}`;
const missingId = (name: string) => `?${name.toLowerCase()}`;

/** Obsidian's node radius for a number of links: 8, growing with the square root past about 6 links. */
export const nodeRadius = (weight: number) => Math.max(8, 3 * Math.sqrt(weight + 1));

/** Palette slots before the colour groups': a node's own colour by kind. */
const KIND_COLOR: Record<NodeKind, number> = { note: 0, unresolved: 1, tag: 2, attachment: 3 };

/**
 * A node's colour: the first colour group that matches it, else its kind's.
 * Groups colour notes only: in Obsidian 1.14.4 (observed) attachments, tags
 * and missing notes keep their own colours whatever the query, even one
 * matching everything.
 */
export function nodeColor(node: GraphNode, groups: readonly { match(node: GraphNode): boolean }[]): number {
  const g = node.kind === "note" ? groups.findIndex((group) => group.match(node)) : -1;
  return g >= 0 ? 4 + g : KIND_COLOR[node.kind];
}

/** Each node's neighbours, packed: node i's are `adj` from `start[i]` up to `start[i + 1]`. */
export function neighbours(n: number, links: readonly GraphLink[]) {
  const start = new Int32Array(n + 1);
  for (const l of links) {
    start[l.source + 1]++;
    start[l.target + 1]++;
  }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const adj = new Int32Array(start[n]);
  const fill = start.slice();
  for (const l of links) {
    adj[fill[l.source]++] = l.target;
    adj[fill[l.target]++] = l.source;
  }
  return { start, adj };
}

export function buildGraph(src: GraphSource, opts: GraphOptions): GraphModel {
  const nodes: GraphNode[] = [];
  const index = new Map<string, number>();
  const add = (id: string, label: string, kind: NodeKind, path?: string) => {
    let i = index.get(id);
    if (i === undefined) {
      i = nodes.length;
      index.set(id, i);
      nodes.push({ id, label, kind, path, weight: 0 });
    }
    return i;
  };
  const include = opts.include ?? (() => true);
  for (const path of src.notes) if (include(path)) add(path, nameOf(path), "note", path);
  if (opts.showAttachments) for (const path of src.attachments) if (include(path)) add(path, nameOf(path), "attachment", path);

  // Directed edges, deduplicated: "a\0b" for a links to b.
  const directed = new Set<string>();
  const edges: [number, number][] = [];
  const link = (from: number, to: number) => {
    if (from === to) return;
    const key = `${from}\0${to}`;
    if (directed.has(key)) return;
    directed.add(key);
    edges.push([from, to]);
  };
  const noteCount = nodes.length;
  for (let from = 0; from < noteCount; from++) {
    const node = nodes[from];
    if (node.kind !== "note") continue;
    const path = node.path!;
    for (const list of [src.links.outgoing[path], src.links.markdown?.[path]]) {
      for (const target of list ?? []) {
        const to = index.get(target);
        if (to !== undefined) link(from, to);
      }
    }
    if (!opts.hideUnresolved) {
      for (const name of src.links.unresolved?.[path] ?? []) link(from, add(missingId(name), name, "unresolved"));
    }
    if (opts.showTags) {
      for (const tag of src.tags?.get(path) ?? []) link(from, add(tagId(tag), `#${tag}`, "tag"));
    }
  }

  let keep: Uint8Array | null = null;
  let traversed: Set<string> | null = null;
  if (opts.local) ({ keep, traversed } = neighbourhood(nodes.length, edges, index.get(opts.local.center), opts.local));

  // One undirected link per pair; `both` when it points both ways.
  const pairs = new Map<string, GraphLink>();
  for (const [a, b] of edges) {
    if (keep && (!keep[a] || !keep[b])) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}\0${hi}`;
    if (traversed && !opts.local!.neighbors && !traversed.has(key)) continue;
    const seen = pairs.get(key);
    if (seen) {
      if (seen.source !== a) seen.both = true;
    } else pairs.set(key, { source: a, target: b, both: false });
    nodes[a].weight++;
    nodes[b].weight++;
  }

  // Keep the nodes that are in: local graph reach; orphans only if asked
  // for (tags and missing notes exist only through their links).
  const out: GraphNode[] = [];
  const remap = new Int32Array(nodes.length).fill(-1);
  const center = opts.local ? index.get(opts.local.center) : undefined;
  nodes.forEach((n, i) => {
    if (keep && !keep[i]) return;
    const linked = n.weight > 0;
    if (!linked && i !== center && (n.kind === "tag" || n.kind === "unresolved" || !opts.showOrphans)) return;
    remap[i] = out.length;
    out.push(n);
  });
  const links: GraphLink[] = [];
  for (const l of pairs.values()) {
    const s = remap[l.source];
    const t = remap[l.target];
    if (s >= 0 && t >= 0) links.push({ source: s, target: t, both: l.both });
  }
  return { nodes: out, links, index: new Map(out.map((n, i) => [n.id, i])) };
}

/**
 * The local graph: nodes within `depth` links of the centre, following links
 * out of a note (outgoing) and into it (incoming) as allowed. The links on
 * those paths are "traversed"; links between the nodes reached that aren't
 * are neighbour links.
 */
function neighbourhood(count: number, edges: [number, number][], center: number | undefined, o: LocalOptions) {
  const keep = new Uint8Array(count);
  const traversed = new Set<string>();
  if (center === undefined) return { keep, traversed };
  const out: number[][] = Array.from({ length: count }, () => []);
  const into: number[][] = Array.from({ length: count }, () => []);
  for (const [a, b] of edges) {
    out[a].push(b);
    into[b].push(a);
  }
  const depth = new Int32Array(count).fill(-1);
  depth[center] = 0;
  keep[center] = 1;
  let frontier = [center];
  const pair = (a: number, b: number) => `${Math.min(a, b)}\0${Math.max(a, b)}`;
  for (let d = 1; d <= Math.max(1, Math.min(5, o.depth)) && frontier.length; d++) {
    const next: number[] = [];
    for (const n of frontier) {
      const step = (m: number) => {
        if (depth[m] === -1) {
          depth[m] = d;
          keep[m] = 1;
          next.push(m);
        }
        if (depth[m] === d) traversed.add(pair(n, m));
      };
      if (o.outgoing) for (const m of out[n]) step(m);
      if (o.incoming) for (const m of into[n]) step(m);
    }
    frontier = next;
  }
  return { keep, traversed };
}
