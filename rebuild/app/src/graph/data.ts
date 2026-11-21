// The graph view's model: which nodes and links to draw, worked out from the
// vault's file list and link index (and tags, when they are shown). Nodes are
// notes; links are resolved wikilinks and markdown links, drawn undirected
// but remembering which way they point (for arrows). Options add tags,
// attachments and links to notes that don't exist yet, hide orphans, filter
// by a search, or keep only the neighbourhood of one note (the local graph).
// Pure and free of the DOM, so it is tested on its own.

import type { LinkIndex } from "../api";
import { type LinkEntry, linkEntryOf } from "../links/linkDelta";
import { isNoteFile, noteName } from "../paths";

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

/** Notes and attachments for the graph. A `.MD` file is a note. Excluded files are left out. */
export function graphFileLists(files: readonly { is_dir: boolean; path: string }[], excluded: (path: string) => boolean): { notes: string[]; attachments: string[] } {
  const notes: string[] = [];
  const attachments: string[] = [];
  for (const f of files) {
    if (f.is_dir || excluded(f.path)) continue;
    if (isNoteFile(f.path)) notes.push(f.path);
    else attachments.push(f.path);
  }
  return { notes, attachments };
}

interface GraphSource {
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

interface GraphOptions {
  showTags: boolean;
  showAttachments: boolean;
  /** "Existing files only": leave out links to notes that don't exist. */
  hideUnresolved: boolean;
  showOrphans: boolean;
  /** The search filter: notes and attachments it rejects are left out. */
  include?: (path: string) => boolean;
  local?: LocalOptions;
}

const nameOf = noteName;
/** One number per ordered pair of node indexes (exact below 2^26 nodes, far past any vault). */
const edgeKey = (a: number, b: number) => a * 67_108_864 + b;
const tagId = (tag: string) => `#${tag.toLowerCase()}`;
const missingId = (name: string) => `?${name.toLowerCase()}`;

/**
 * The node ids a note's links point at, as `buildGraph` makes them: resolved targets
 * (notes and attachments, by path) and, unless unresolved links are hidden, the missing
 * notes' ids. Tags are not links (a graph that shows them rebuilds on every refresh).
 */
export function linkedIds(entry: LinkEntry, hideUnresolved: boolean): string[] {
  const out = [...entry.outgoing ?? [], ...entry.markdown ?? []];
  if (!hideUnresolved) for (const name of entry.unresolved ?? []) out.push(missingId(name));
  return out;
}

/**
 * Whether a link refresh that changed `touched` notes' entries (null: unknown) can
 * change a graph. Without tags or a text query (`readsText`) a graph is its files
 * and links, so a refresh that changed no entry (a save of prose) changes nothing.
 * A local graph (`shown`: the ids of the nodes it has) also stays when no changed
 * note is in it and none of them links to a node in it, resolved or missing
 * (`linkedIds`), before the refresh (`oldEntryOf`) or after it (`entryOf`): such a
 * note was out of reach before and still is. Both matter: a missing note's label is
 * the spelling of the first note linking to it, in or out of reach, so adding or
 * removing a link to it from anywhere can change that label (review 3). Any other
 * change rebuilds a global graph.
 */
export function localLinksMatter(
  touched: ReadonlySet<string> | null,
  shown: ReadonlyMap<string, number> | null,
  readsText: boolean,
  hideUnresolved: boolean,
  entryOf: (path: string) => LinkEntry,
  oldEntryOf: (path: string) => LinkEntry,
): boolean {
  if (!touched || readsText) return true;
  if (!touched.size) return false;
  if (!shown) return true;
  for (const path of touched) {
    if (shown.has(path)) return true;
    for (const entry of [oldEntryOf(path), entryOf(path)]) {
      for (const id of linkedIds(entry, hideUnresolved)) if (shown.has(id)) return true;
    }
  }
  return false;
}

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
  return drain(neighbourSteps(n, links));
}

/** `neighbours` in steps (it yields every `STEP` links). */
export function* neighbourSteps(n: number, links: readonly GraphLink[]): Generator<void, { start: Int32Array<ArrayBuffer>; adj: Int32Array<ArrayBuffer> }> {
  const start = new Int32Array(n + 1);
  for (let i = 0; i < links.length; i++) {
    if (i % STEP === STEP - 1) yield;
    const l = links[i];
    start[l.source + 1]++;
    start[l.target + 1]++;
  }
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const adj = new Int32Array(start[n]);
  const fill = start.slice();
  for (let i = 0; i < links.length; i++) {
    if (i % STEP === STEP - 1) yield;
    const l = links[i];
    adj[fill[l.source]++] = l.target;
    adj[fill[l.target]++] = l.source;
  }
  return { start, adj };
}

/** Run steps to the end at once. */
export function drain<T>(work: Generator<void, T>): T {
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
  }
}

/** Whether two models have the same nodes (ids, in order) and links (ends, in order): what the layout keys on. In steps. */
export function* sameShape(a: GraphModel, b: GraphModel): Generator<void, boolean> {
  if (a.nodes.length !== b.nodes.length || a.links.length !== b.links.length) return false;
  for (let i = 0; i < a.nodes.length; i++) {
    if (i % STEP === STEP - 1) yield;
    if (a.nodes[i].id !== b.nodes[i].id) return false;
  }
  for (let i = 0; i < a.links.length; i++) {
    if (i % STEP === STEP - 1) yield;
    if (a.links[i].source !== b.links[i].source || a.links[i].target !== b.links[i].target) return false;
  }
  return true;
}

/** Node indexes by colour, each colour's in index order (the order a stable sort by colour gives). */
export function drawOrder(colorOf: Int16Array): Int32Array<ArrayBuffer> {
  let top = 0;
  for (let i = 0; i < colorOf.length; i++) top = Math.max(top, colorOf[i]);
  const at = new Int32Array(top + 2);
  for (let i = 0; i < colorOf.length; i++) at[colorOf[i] + 1]++;
  for (let c = 0; c <= top; c++) at[c + 1] += at[c];
  const order = new Int32Array(colorOf.length);
  for (let i = 0; i < colorOf.length; i++) order[at[colorOf[i]]++] = i;
  return order;
}

export function buildGraph(src: GraphSource, opts: GraphOptions): GraphModel {
  const steps = buildGraphSteps(src, opts);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Notes (or links) handled between the pauses of `buildGraphSteps`. */
const STEP = 1024;

/**
 * `buildGraph` in steps: it pauses (yields) every `STEP` notes and links, so a
 * caller can spread a large rebuild over several frames (review 2). Running it to
 * the end gives exactly what `buildGraph` returns. `src` must not change meanwhile.
 */
export function* buildGraphSteps(src: GraphSource, opts: GraphOptions): Generator<void, GraphModel> {
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
  let listed = 0;
  for (const path of src.notes) {
    if (++listed % STEP === 0) yield;
    if (include(path)) add(path, nameOf(path), "note", path);
  }
  if (opts.showAttachments) {
    for (const path of src.attachments) {
      if (++listed % STEP === 0) yield;
      if (include(path)) add(path, nameOf(path), "attachment", path);
    }
  }

  // Directed edges, deduplicated: `edgeKey(a, b)` for a links to b (a number: hashing a
  // string per edge was most of a 50k-note build).
  const directed = new Set<number>();
  const edges: [number, number][] = [];
  const link = (from: number, to: number) => {
    if (from === to) return;
    const key = edgeKey(from, to);
    if (directed.has(key)) return;
    directed.add(key);
    edges.push([from, to]);
  };
  const noteCount = nodes.length;
  for (let from = 0; from < noteCount; from++) {
    if (from % STEP === STEP - 1) yield;
    const node = nodes[from];
    if (node.kind !== "note") continue;
    const path = node.path!;
    // One note's entry, without building the whole maps (review 2).
    const entry = linkEntryOf(src.links, path);
    for (const list of [entry.outgoing, entry.markdown]) {
      for (const target of list ?? []) {
        const to = index.get(target);
        if (to !== undefined) link(from, to);
      }
    }
    if (!opts.hideUnresolved) {
      for (const name of entry.unresolved ?? []) link(from, add(missingId(name), name, "unresolved"));
    }
    if (opts.showTags) {
      for (const tag of src.tags?.get(path) ?? []) link(from, add(tagId(tag), `#${tag}`, "tag"));
    }
  }

  let keep: Uint8Array | null = null;
  let traversed: Set<number> | null = null;
  if (opts.local) ({ keep, traversed } = yield* neighbourhood(nodes.length, edges, index.get(opts.local.center), opts.local));

  // One undirected link per pair; `both` when it points both ways.
  const pairs = new Map<number, GraphLink>();
  let counted = 0;
  for (const [a, b] of edges) {
    if (++counted % STEP === 0) yield;
    if (keep && (!keep[a] || !keep[b])) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = edgeKey(lo, hi);
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
  // Review 3: these last passes pause too, so no step of a rebuild is a whole-model pass.
  const out: GraphNode[] = [];
  const remap = new Int32Array(nodes.length).fill(-1);
  const center = opts.local ? index.get(opts.local.center) : undefined;
  for (let i = 0; i < nodes.length; i++) {
    if (i % STEP === STEP - 1) yield;
    const n = nodes[i];
    if (keep && !keep[i]) continue;
    const linked = n.weight > 0;
    if (!linked && i !== center && (n.kind === "tag" || n.kind === "unresolved" || !opts.showOrphans)) continue;
    remap[i] = out.length;
    out.push(n);
  }
  const links: GraphLink[] = [];
  counted = 0;
  for (const l of pairs.values()) {
    if (++counted % STEP === 0) yield;
    const s = remap[l.source];
    const t = remap[l.target];
    if (s >= 0 && t >= 0) links.push({ source: s, target: t, both: l.both });
  }
  const at = new Map<string, number>();
  for (let i = 0; i < out.length; i++) {
    if (i % STEP === STEP - 1) yield;
    at.set(out[i].id, i);
  }
  return { nodes: out, links, index: at };
}

/**
 * The local graph: nodes within `depth` links of the centre, following links
 * out of a note (outgoing) and into it (incoming) as allowed. The links on
 * those paths are "traversed"; links between the nodes reached that aren't
 * are neighbour links.
 */
function* neighbourhood(count: number, edges: [number, number][], center: number | undefined, o: LocalOptions): Generator<void, { keep: Uint8Array; traversed: Set<number> }> {
  const keep = new Uint8Array(count);
  const traversed = new Set<number>();
  if (center === undefined) return { keep, traversed };
  const out: number[][] = [];
  const into: number[][] = [];
  for (let i = 0; i < count; i++) {
    if (i % STEP === STEP - 1) yield;
    out.push([]);
    into.push([]);
  }
  let counted = 0;
  for (const [a, b] of edges) {
    if (++counted % STEP === 0) yield;
    out[a].push(b);
    into[b].push(a);
  }
  const depth = new Int32Array(count).fill(-1);
  depth[center] = 0;
  keep[center] = 1;
  let frontier = [center];
  const pair = (a: number, b: number) => edgeKey(Math.min(a, b), Math.max(a, b));
  for (let d = 1; d <= Math.max(1, Math.min(5, o.depth)) && frontier.length; d++) {
    const next: number[] = [];
    for (const n of frontier) {
      if (++counted % STEP === 0) yield;
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
