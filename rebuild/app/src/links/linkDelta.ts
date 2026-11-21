// The link index, read as changes since the last reply (R2 P2b).
//
// The backend keeps every note's resolved links and a version that moves each
// time a note's entry changes. `link_changes` with the id and version of an
// earlier reply returns only the notes whose entries changed since; this module
// lays them on its copy of that reply. Without a usable base (first read,
// another vault, a reopen, or a page too far behind) the backend sends the
// whole index instead, the same `LinkIndex` `link_index` returns.
//
// Each read returns a new top-level object, as a full read did, so consumers
// that compare `vault.links` by identity still see every refresh. A read is a
// snapshot: nothing here edits an object it has handed out, so a reply a
// consumer holds keeps the values it had.
//
// A read costs only the changed notes (review 1). Each of the three maps is a
// layer: the last whole map plus the changed paths laid over it. The whole map
// is built (one copy, with the new paths at their sorted places) only when
// something reads that map, and then kept, so a save that nobody reads the map
// after, or that changes nothing, copies nothing. A map no changed note touches
// is the previous reply's own object. Once the changes reach an eighth of the
// map they are folded into a new root in the background, a few thousand keys per
// task (`compact`), so carrying them from one read to the next stays a small
// share of what building the map costs, and no single task pays for the map.
//
// Key order matches a full reply: the backend's maps are sorted by path (UTF-8
// byte order, which is code point order), and a path new to a map is inserted
// at its sorted place, so iterating a built map visits paths in the same order
// as iterating a full read.
//
// `linkChanges(older, newer)` names the notes whose entries may differ between
// two reads (the union of the changes in between), so consumers can update only
// those, or nothing when it is empty (a save that changed only prose).

import type { LinkIndex } from "../api";

/** One note's part of the index. A missing list is empty; all three empty means the note has no links. */
export interface LinkEntry {
  outgoing?: string[];
  markdown?: string[];
  unresolved?: string[];
}

/** `link_changes`' reply. */
export interface LinkChanges {
  id: number;
  version: number;
  /** The version `changed` is relative to; null with `full`. */
  since: number | null;
  /** The whole index, when the request had no usable base. */
  full: LinkIndex | null;
  /** Each note whose entry changed since `since`, with its whole new entry. */
  changed: Record<string, LinkEntry>;
}

export type Field = "outgoing" | "markdown" | "unresolved";
const FIELDS: readonly Field[] = ["outgoing", "markdown", "unresolved"];
type PathMap = Record<string, string[]>;

/** Code point order (UTF-16 order differs for astral characters against U+E000–U+FFFF). */
export function byCodePoint(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i), y = b.charCodeAt(i);
    if (x === y) continue;
    // Surrogates (astral characters) sort above the rest of the BMP.
    if (x >= 0xd800 && y >= 0xd800) {
      x = x <= 0xdfff ? x + 0x2000 : x - 0x800;
      y = y <= 0xdfff ? y + 0x2000 : y - 0x800;
    }
    return x - y;
  }
  return a.length - b.length;
}

const sameList = (a: readonly string[] | undefined, b: readonly string[]) =>
  a !== undefined && a.length === b.length && a.every((value, i) => value === b[i]);

const own = (map: PathMap, path: string): string[] | undefined =>
  Object.prototype.hasOwnProperty.call(map, path) ? map[path] : undefined;

/**
 * One map of one read: `root` with `over` laid on it (null removes a path).
 * Building it folds `over` into a new `root` in place; the map it stands for
 * never changes, and no map it handed out is edited.
 */
interface Layer {
  root: PathMap;
  over: ReadonlyMap<string, string[] | null> | null;
  /** Paths in the map this layer stands for. */
  readonly size: number;
  /** The reads patched one from another: each patch lays its changes on the line's newest layer. */
  readonly line: Line;
}

/** One map's run of layers, for compaction (`compact`). */
interface Line {
  latest: Layer | null;
  compacting: boolean;
}

/** Compact a line once its newest layer holds this share of the map (and at least `MIN_OVER` paths). */
const OVER_SHARE = 8;
const MIN_OVER = 64;
/** Keys a compaction copies per task. */
const COMPACT_STEP = 4096;

function lookup(layer: Layer, path: string): string[] | undefined {
  if (layer.over?.has(path)) return layer.over.get(path) ?? undefined;
  return own(layer.root, path);
}

/** `root` with `over` applied: removed paths left out, changed ones replaced, new ones at their sorted places. */
function fold(root: PathMap, over: ReadonlyMap<string, string[] | null>): PathMap {
  const added = [...over.keys()].filter((path) => over.get(path) !== null && own(root, path) === undefined).sort(byCodePoint);
  const next: PathMap = {};
  let at = 0;
  for (const path of Object.keys(root)) {
    while (at < added.length && byCodePoint(added[at]!, path) < 0) {
      next[added[at]!] = over.get(added[at]!)!;
      at += 1;
    }
    const value = over.has(path) ? over.get(path) : root[path];
    if (value) next[path] = value;
  }
  for (; at < added.length; at++) next[added[at]!] = over.get(added[at]!)!;
  return next;
}

function built(layer: Layer): PathMap {
  if (layer.over) {
    layer.root = fold(layer.root, layer.over);
    layer.over = null;
  }
  return layer.root;
}

const plainLayer = (map: PathMap | undefined): Layer => {
  const root = map ?? {};
  const line: Line = { latest: null, compacting: false };
  const layer: Layer = { root, over: null, size: Object.keys(root).length, line };
  line.latest = layer;
  return layer;
};

let compactions = 0;
let compacted: (() => void)[] = [];
/** Per compaction task: the keys and comparisons it handled (tests: none exceeds a step). */
let taskSizes: number[] = [];

/** Work a compaction generator does between pauses (a key copied, a comparison, a check). */
const PAUSE_EVERY = 64;
/** That work, counted as it is done. */
let ops = 0;
const tick = () => ++ops % PAUSE_EVERY === 0;

/**
 * Fold a line's pile of changes into a new root in the background, about
 * `COMPACT_STEP` keys per task (review 2: no read, and no patch, pays for a whole
 * map at once). Review 3: every phase is in those steps: listing the root's keys,
 * finding and sorting the new paths, the merge with the ones past the last key,
 * and the re-rooting. The fold is of the newest layer as it was when this started.
 * When it is done the then-newest layer is re-rooted on it, keeping only the
 * changes made since. That layer stands for the same map before and after, and
 * maps already handed out are not touched. Patches meanwhile keep laying their
 * changes on the old root.
 */
function compact(line: Line) {
  const start = line.latest;
  if (line.compacting || !start?.over) return;
  line.compacting = true;
  compactions += 1;
  const work = compaction(line, start.root, start.over);
  const step = () => {
    const before = ops;
    for (let i = 0; i < COMPACT_STEP / PAUSE_EVERY; i++) {
      if (!work.next().done) continue;
      taskSizes.push(ops - before);
      line.compacting = false;
      compactions -= 1;
      if (!compactions) for (const done of compacted.splice(0)) done();
      if (line.latest?.over && line.latest.over.size > threshold(line.latest.size)) compact(line);
      return;
    }
    taskSizes.push(ops - before);
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

/** A compaction's steps: it pauses (yields) every `PAUSE_EVERY` keys or comparisons. */
function* compaction(line: Line, root: PathMap, over: ReadonlyMap<string, string[] | null>): Generator<void, void> {
  const keys: string[] = [];
  for (const path in root) {
    keys.push(path);
    if (tick()) yield;
  }
  const fresh: string[] = [];
  for (const [path, value] of over) {
    if (value !== null && own(root, path) === undefined) fresh.push(path);
    if (tick()) yield;
  }
  const added = yield* sortSteps(fresh, byCodePoint);
  const next: PathMap = {};
  let at = 0;
  for (const path of keys) {
    while (at < added.length && byCodePoint(added[at]!, path) < 0) {
      next[added[at]!] = over.get(added[at]!)!;
      at += 1;
      if (tick()) yield;
    }
    const value = over.has(path) ? over.get(path) : root[path];
    if (value) next[path] = value;
    if (tick()) yield;
  }
  for (; at < added.length; at++) {
    next[added[at]!] = over.get(added[at]!)!;
    if (tick()) yield;
  }
  // Re-root the newest layer, in steps too. A patch meanwhile makes a newer layer (laid on
  // the same root, holding these changes and more): start that one over.
  for (let tries = 0; tries < 8; tries++) {
    const layer = line.latest;
    // Built or re-rooted meanwhile, or laid on another base: leave it.
    if (!layer?.over || layer.root !== root) return;
    const lay = layer.over;
    let holds = true;
    for (const path of over.keys()) {
      if (!lay.has(path)) { holds = false; break; }
      if (tick()) yield;
    }
    if (!holds) return;
    const rest = new Map<string, string[] | null>();
    for (const [path, value] of lay) {
      if (!(over.has(path) && over.get(path) === value)) rest.set(path, value);
      if (tick()) yield;
    }
    if (line.latest !== layer || layer.over !== lay || layer.root !== root) continue;
    layer.root = next;
    layer.over = rest.size ? rest : null;
    return;
  }
}

/** A stable merge sort in steps (it yields every `PAUSE_EVERY` comparisons or moves). */
function* sortSteps<T>(values: T[], compare: (a: T, b: T) => number): Generator<void, T[]> {
  let from = values.slice(), to = new Array<T>(values.length);
  for (let width = 1; width < values.length; width *= 2) {
    for (let start = 0; start < values.length; start += width * 2) {
      let left = start, right = Math.min(start + width, values.length);
      const mid = right, end = Math.min(start + width * 2, values.length);
      for (let at = start; at < end; at++) {
        to[at] = left < mid && (right >= end || compare(from[left]!, from[right]!) <= 0) ? from[left++]! : from[right++]!;
        if (tick()) yield;
      }
    }
    [from, to] = [to, from];
  }
  return from;
}

const threshold = (size: number) => Math.max(MIN_OVER, size / OVER_SHARE);

/** The work of each compaction task since the last call (tests). */
export function compactionTasks(): number[] {
  return taskSizes.splice(0);
}

/** Resolves once no compaction is running (tests). */
export function linkCompactions(): Promise<void> {
  return compactions ? new Promise((done) => compacted.push(done)) : Promise.resolve();
}

/** Changes laid over a read's map, not folded into its root yet (tests). */
export function overlaySize(links: LinkIndex, field: Field): number {
  return layersOf.get(links)?.[field].over?.size ?? 0;
}

type Layers = Record<Field, Layer>;
const layersOf = new WeakMap<LinkIndex, Layers>();
/** How a read came from an earlier one: the earlier read (weakly; an old read can go) and the notes that changed. */
const parentOf = new WeakMap<LinkIndex, { from: WeakRef<LinkIndex>; paths: ReadonlySet<string> }>();

/** A read over `layers`: each map is built when first read. Assigning a map replaces it. */
function snapshot(layers: Layers): LinkIndex {
  const out = {} as LinkIndex;
  for (const field of FIELDS) {
    Object.defineProperty(out, field, {
      enumerable: true,
      configurable: true,
      get: () => built(layers[field]),
      set: (map: PathMap) => {
        layers[field] = plainLayer(map);
      },
    });
  }
  layersOf.set(out, layers);
  return out;
}

function layersFrom(links: LinkIndex): Layers {
  return layersOf.get(links) ?? { outgoing: plainLayer(links.outgoing), markdown: plainLayer(links.markdown), unresolved: plainLayer(links.unresolved) };
}

/** A full reply as a read: its maps are used as they are. */
function whole(full: LinkIndex): LinkIndex {
  return snapshot(layersFrom(full));
}

/** `base` with each changed note's entry put in, and the notes whose entries actually changed. `base` is left as it was. */
function laid(base: LinkIndex, changed: Record<string, LinkEntry>): LinkIndex {
  const prev = layersFrom(base);
  const paths = new Set<string>();
  const changedPaths = Object.keys(changed);
  const layers = {} as Layers;
  for (const field of FIELDS) {
    const layer = prev[field];
    let over: Map<string, string[] | null> | null = null;
    let size = layer.size;
    for (const path of changedPaths) {
      const want = changed[path]![field] ?? [];
      const had = lookup(layer, path);
      if (!want.length) {
        if (had === undefined) continue;
        (over ??= new Map()).set(path, null);
        size -= 1;
      } else if (sameList(had, want)) continue;
      else {
        (over ??= new Map()).set(path, want);
        if (had === undefined) size += 1;
      }
      paths.add(path);
    }
    if (!over) {
      // Untouched: the same layer, so the same built map.
      layers[field] = layer;
      continue;
    }
    // Lay the changes on the last built map, or on top of the changes not built yet.
    const next: Layer = { root: layer.root, over: layer.over ? new Map([...layer.over, ...over]) : over, size, line: layer.line };
    layer.line.latest = next;
    if (next.over!.size > threshold(size)) compact(layer.line);
    layers[field] = next;
  }
  const out = snapshot(layers);
  parentOf.set(out, { from: new WeakRef(base), paths });
  return out;
}

/** `base` with each changed note's entry put in. `base` is left as it was. */
export function patchLinks(base: LinkIndex, changed: Record<string, LinkEntry>): LinkIndex {
  return laid(base, changed);
}

/** One note's entry in a read, without building any map. */
export function linkEntryOf(links: LinkIndex, path: string): LinkEntry {
  const layers = layersOf.get(links);
  const get = (field: Field) => (layers ? lookup(layers[field], path) : own(links[field] ?? {}, path));
  const entry: LinkEntry = {};
  for (const field of FIELDS) {
    const list = get(field);
    if (list?.length) entry[field] = list;
  }
  return entry;
}

/**
 * The notes whose entries may differ between two reads from one reader, `newer`
 * patched (in one or more steps) from `older`: empty when no entry changed. Null
 * when that is not known (a full reply in between, reads from elsewhere): treat
 * every note as changed.
 */
export function linkChanges(older: LinkIndex, newer: LinkIndex): ReadonlySet<string> | null {
  if (older === newer) return new Set();
  const out = new Set<string>();
  let at: LinkIndex | undefined = newer;
  for (let hops = 0; at && hops < 64; hops++) {
    const step = parentOf.get(at);
    if (!step) return null;
    for (const path of step.paths) out.add(path);
    at = step.from.deref();
    if (at === older) return out;
  }
  return null;
}

type Ask = (id: number | null, version: number | null) => Promise<LinkChanges>;

/**
 * A reader for one page: each call returns the current link index, patched
 * from the newest reply it has. Overlapping calls are safe: each patches the
 * base it asked from. The kept base moves only forward: to a higher version of
 * the same index, or to another index (another vault) from a later call.
 */
export function linkReader(ask: Ask): () => Promise<LinkIndex> {
  let kept: { id: number; version: number; links: LinkIndex; call: number } | null = null;
  let calls = 0;
  return async () => {
    const call = ++calls;
    const base = kept;
    const reply = await ask(base?.id ?? null, base?.version ?? null);
    let links: LinkIndex;
    if (reply.full) links = whole(reply.full);
    else if (base && reply.id === base.id && reply.since === base.version) links = laid(base.links, reply.changed);
    else {
      // Not a reply to what was asked (it can't happen with the real backend): start over.
      kept = null;
      const again = await ask(null, null);
      if (!again.full) throw new Error("link_changes sent changes without a base");
      links = whole(again.full);
      kept = { id: again.id, version: again.version, links, call };
      return links;
    }
    const newer = !kept || (kept.id === reply.id ? kept.version <= reply.version : kept.call < call);
    if (newer) kept = { id: reply.id, version: reply.version, links, call };
    return links;
  };
}
