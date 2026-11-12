// Per-item localStorage keys for the save handoff. Each page keeps its own
// journal in memory. These helpers only read and write one key at a time, so
// replaying one window cannot rebuild another window's record.

export const HANDOFF_PREFIX = "grove.saveHandoff.";

export type ItemKind = "n" | "c" | "s" | "b" | "p" | "y";

export interface StoredHandoff {
  notes?: { vault: string; path: string; text: string; gen?: number }[];
  configs?: { vault: string; name: string; text: string }[];
  structural?: { vault: string; kind: string; path: string; content?: string }[];
  bytes?: { vault: string; path: string; op: string; b64: string }[];
  props?: { vault: string; path: string; edit: unknown }[];
}

export function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function storedKeys(disk: Storage): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < disk.length; i++) {
      const key = disk.key(i);
      if (key && key.startsWith(HANDOFF_PREFIX)) out.push(key);
    }
  } catch { /* a storage that cannot be listed keeps the keys we already know */ }
  return out;
}

export function itemKind(key: string): ItemKind | null {
  const rest = key.startsWith(HANDOFF_PREFIX) ? key.slice(HANDOFF_PREFIX.length) : "";
  const kind = rest.split(".")[1];
  if (kind === "n" || kind === "c" || kind === "s" || kind === "b" || kind === "p" || kind === "y") return kind;
  return null;
}

export function pageStoreOf(key: string): string {
  const rest = key.startsWith(HANDOFF_PREFIX) ? key.slice(HANDOFF_PREFIX.length) : "";
  return HANDOFF_PREFIX + (rest.split(".")[0] ?? "");
}

export function itemKey(pageStore: string, kind: ItemKind, id: string): string {
  return `${pageStore}.${kind}.${encodeURIComponent(id)}`;
}

function emptyBody(body: StoredHandoff): boolean {
  return !body.notes?.length && !body.configs?.length && !body.structural?.length && !body.bytes?.length && !body.props?.length;
}

/** Write one item and read it back. False when storage refuses or disagrees. */
export function writeItem(key: string, value: unknown): boolean {
  const disk = storage();
  if (!disk) return false;
  try {
    const json = JSON.stringify(value);
    disk.setItem(key, json);
    return disk.getItem(key) === json;
  } catch {
    return false;
  }
}

/** Remove one item key. A different key is never rewritten. */
export function dropKey(key: string): boolean {
  const disk = storage();
  if (!disk) return false;
  try {
    disk.removeItem(key);
    return disk.getItem(key) === null;
  } catch {
    return false;
  }
}

/**
 * Remove entries from a legacy single-blob record by reading it now.
 * Unknown notes added after this page loaded stay in the blob.
 */
export function stripLegacy(key: string, edit: (body: StoredHandoff) => StoredHandoff): boolean {
  const disk = storage();
  if (!disk) return false;
  const raw = disk.getItem(key);
  if (raw == null) return true;
  let saved: StoredHandoff;
  try { saved = JSON.parse(raw) as StoredHandoff; } catch { return false; }
  const next = edit(saved);
  try {
    if (emptyBody(next)) {
      disk.removeItem(key);
      return disk.getItem(key) === null;
    }
    const json = JSON.stringify(next);
    if (json === raw) return true;
    disk.setItem(key, json);
    return disk.getItem(key) === json;
  } catch {
    return false;
  }
}

export function ackKey(key: string, edit: (body: StoredHandoff) => StoredHandoff): boolean {
  if (itemKind(key)) return dropKey(key);
  return stripLegacy(key, edit);
}
