// Every note's properties across the vault, for the All properties view,
// the Properties block's suggestions and search's [property] terms. Built
// the first time one of them asks, from the backend's `frontmatter`
// command (only the frontmatter lines, never a note's body), and kept per
// note while its modified time stays the same: after a save, or a
// vault-changed from outside (both mark the file modified), only that note
// is read again. Notes open in an editor are read from it, so unsaved
// edits count. Excluded files (Settings → Files and links) are left out.

import { api } from "../api";
import { fixedType, type Property, type PropertyType, readFrontmatter, readProperties, splitFrontmatter, STORED_TYPES } from "../editor/frontmatter";
import type { PropertyHost } from "../editor/host";
import { compareNames } from "../paths";
import { settings } from "../settings/store";
import { kept, perWorkspace } from "../memo";
import type { Workspace } from "../workspace";
import { vaultTags } from "./vaultTags";

export interface NoteProperties {
  props: Property[];
  /** The frontmatter's lines (between the `---` lines), for showing a property's line. */
  lines: string[];
}

export interface PropertyName {
  key: string;
  /** Its type: the one chosen for it, else `inferred`. */
  type: PropertyType;
  /** The type most of its values have. */
  inferred: PropertyType;
  /** How many notes have it. */
  count: number;
}

const BY_STORED = Object.fromEntries(Object.entries(STORED_TYPES).map(([type, stored]) => [stored, type as PropertyType]));

/** The type chosen for a property name in this vault (types.json), or null: automatic, from its value. */
const chosenType = (key: string): PropertyType | null => fixedType(key) ?? BY_STORED[settings.propertyTypes[key]] ?? null;

const parse = (lines: string[]): NoteProperties | null => {
  const props = readProperties(lines);
  return props ? { props, lines } : null;
};

/** The workspace's properties index (one for every view that needs it). */
export const propertyIndex = perWorkspace((ws: Workspace) => {
  const cache = new Map<string, { mtime: number; entry: NoteProperties | null }>();
  let reading: Promise<Map<string, NoteProperties>> | null = null;

  async function read(): Promise<Map<string, NoteProperties>> {
    const notes = ws.vault.includedNotes();
    const mtimes = new Map(ws.vault.files.map((f) => [f.path, f.mtime_ms]));
    const stale = notes.map((n) => n.path).filter((p) => !ws.editors.isLoaded(p) && cache.get(p)?.mtime !== mtimes.get(p));
    if (stale.length) {
      // Most of the vault (the first read): ask for everything in one go.
      const blocks = await api.frontmatter(stale.length > notes.length / 2 ? undefined : stale);
      for (const path of stale) {
        const split = blocks[path] ? splitFrontmatter(blocks[path]) : null;
        cache.set(path, { mtime: mtimes.get(path) ?? 0, entry: split && parse(split.lines) });
      }
    }
    const known = new Set(notes.map((n) => n.path));
    for (const path of cache.keys()) if (!known.has(path)) cache.delete(path);
    const out = new Map<string, NoteProperties>();
    for (const { path } of notes) {
      const doc = ws.editors.isLoaded(path) ? ws.editors.doc(path) : undefined;
      const fm = doc && readFrontmatter(doc);
      const entry = doc ? fm?.props && { props: fm.props, lines: fm.lines } : cache.get(path)?.entry;
      if (entry) out.set(path, entry);
    }
    return out;
  }

  /** Every note's properties (one read at a time; a call meanwhile shares it). */
  function notes(): Promise<Map<string, NoteProperties>> {
    reading ??= read().finally(() => (reading = null));
    return reading;
  }

  /** Property names in the vault with how many notes have each, and its type (chosen, else the most common). */
  async function names(): Promise<PropertyName[]> {
    const found = new Map<string, { count: number; types: Map<PropertyType, number> }>();
    for (const { props } of (await notes()).values()) {
      for (const p of props) {
        const n = kept(found, p.key, () => ({ count: 0, types: new Map<PropertyType, number>() }));
        n.count++;
        if (p.type !== "unknown") n.types.set(p.type, (n.types.get(p.type) ?? 0) + 1);
      }
    }
    return [...found].map(([key, n]) => {
      const inferred = [...n.types].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "text";
      return { key, count: n.count, type: chosenType(key) ?? inferred, inferred };
    });
  }

  /** The values a property name has across the vault, sorted (for tags: every tag in the vault). */
  async function values(key: string): Promise<string[]> {
    if (key.toLowerCase() === "tags") {
      const byNote = await vaultTags(ws).read().catch(() => new Map<string, string[]>());
      return dedupe([...byNote.values()].flat());
    }
    const out: string[] = [];
    for (const { props } of (await notes()).values()) {
      for (const p of props) {
        if (p.key !== key || p.type === "unknown") continue;
        if (Array.isArray(p.value)) out.push(...p.value);
        else if (typeof p.value === "string" && p.value) out.push(p.value);
      }
    }
    return dedupe(out);
  }

  /** What the Properties block asks of the vault. */
  const host: PropertyHost = {
    typeOf: chosenType,
    setType: (key, type) => settings.setPropertyType(key, type && STORED_TYPES[type]),
    names: async () => (await names()).sort((a, b) => b.count - a.count || compareNames(a.key, b.key)),
    values,
  };

  return { notes, names, values, host };
});


/** Case-insensitively unique (the first spelling kept), sorted by name. */
function dedupe(list: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of list) if (!seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  return [...seen.values()].sort(compareNames);
}
