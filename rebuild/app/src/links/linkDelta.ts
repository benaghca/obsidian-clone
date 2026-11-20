// The link index, read as changes since the last reply (R2 P2b).
//
// The backend keeps every note's resolved links and a version that moves each
// time a note's entry changes. `link_changes` with the id and version of an
// earlier reply returns only the notes whose entries changed since; this module
// patches its copy of that reply with them. Without a usable base (first read,
// another vault, a reopen, or a page too far behind) the backend sends the
// whole index instead, the same `LinkIndex` `link_index` returns.
//
// Each read returns a new top-level object, as a full read did, so consumers
// that compare `vault.links` by identity still see every refresh. A map no
// changed note touches is shared with the previous reply; one that is touched
// is copied. Nothing here edits an object it has handed out.
//
// Key order matches a full reply: the backend's maps are sorted by path (UTF-8
// byte order, which is code point order), and a path new to a map is inserted
// at its sorted place, so iterating a patched map visits paths in the same
// order as iterating a full read.

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

type Field = "outgoing" | "markdown" | "unresolved";
const FIELDS: readonly Field[] = ["outgoing", "markdown", "unresolved"];

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

/** `base` with each changed note's entry put in. `base` is left as it was. */
export function patchLinks(base: LinkIndex, changed: Record<string, LinkEntry>): LinkIndex {
  const out: LinkIndex = { ...base };
  const paths = Object.keys(changed);
  for (const field of FIELDS) {
    const old: Record<string, string[]> = base[field] ?? {};
    const set = new Map<string, string[]>();
    const drop = new Set<string>();
    for (const path of paths) {
      const next = changed[path]![field] ?? [];
      const prev = Object.prototype.hasOwnProperty.call(old, path) ? old[path] : undefined;
      if (!next.length) {
        if (prev !== undefined) drop.add(path);
      } else if (!sameList(prev, next)) set.set(path, next);
    }
    // Untouched: `out` already shares it.
    if (!set.size && !drop.size) continue;
    const added = [...set.keys()].filter((path) => !Object.prototype.hasOwnProperty.call(old, path)).sort(byCodePoint);
    const next: Record<string, string[]> = {};
    let at = 0;
    for (const path of Object.keys(old)) {
      while (at < added.length && byCodePoint(added[at]!, path) < 0) {
        next[added[at]!] = set.get(added[at]!)!;
        at += 1;
      }
      if (drop.has(path)) continue;
      next[path] = set.get(path) ?? old[path]!;
    }
    for (; at < added.length; at++) next[added[at]!] = set.get(added[at]!)!;
    out[field] = next;
  }
  return out;
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
    if (reply.full) links = reply.full;
    else if (base && reply.id === base.id && reply.since === base.version) links = patchLinks(base.links, reply.changed);
    else {
      // Not a reply to what was asked (it can't happen with the real backend): start over.
      kept = null;
      const again = await ask(null, null);
      if (!again.full) throw new Error("link_changes sent changes without a base");
      links = again.full;
      kept = { id: again.id, version: again.version, links, call };
      return links;
    }
    const newer = !kept || (kept.id === reply.id ? kept.version <= reply.version : kept.call < call);
    if (newer) kept = { id: reply.id, version: reply.version, links, call };
    return links;
  };
}
