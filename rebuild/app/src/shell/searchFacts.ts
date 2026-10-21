// What search queries need to know of the vault, for the search view and
// the graph's filter and groups: the lines the backend's search finds for
// each of their terms, the notes' tags and their properties. Each is asked
// for only when a query uses it, and kept until the vault changes (a
// moment after a save, or a change from outside), so typing a query asks
// the backend only about the term being typed.

import { api } from "../api";
import { perWorkspace } from "../perWorkspace";
import type { Workspace } from "../workspace";
import { type NoteProperties, propertyIndex } from "./propertyIndex";
import { type Facts, type Line, needs, type Query, termsOf } from "./searchQuery";
import { vaultTags } from "./vaultTags";

export interface VaultFacts extends Facts {
  tags?: Map<string, string[]>;
  /** Each note's properties and frontmatter lines (when the query asks about properties), for showing their lines. */
  notes?: Map<string, NoteProperties>;
}

/** Terms remembered at most (the prefixes of what was typed, mostly). */
const KEEP = 200;

/** The workspace's facts (one cache for every search and graph). */
export const searchFacts = perWorkspace((ws: Workspace) => {
  const lines = new Map<string, Promise<Map<string, Line[]>>>();
  ws.on((change) => {
    if (change === "files" || change === "links") lines.clear();
  });

  /** The lines with a term, per note. The backend finds lines with all its words; a phrase is then looked for whole. */
  function linesOf(term: string) {
    let found = lines.get(term);
    if (!found) {
      // Enough for every note to have a line even when most of the vault matches (the hits are round-robin).
      const limit = Math.max(2000, ws.vault.files.length * 4);
      found = api.search(term, limit).then(
        (hits) => {
          const out = new Map<string, Line[]>();
          for (const hit of hits) {
            if (hit.line <= 0 || (term.includes(" ") && !hit.text.toLowerCase().includes(term))) continue;
            const list = out.get(hit.path);
            if (list) list.push(hit);
            else out.set(hit.path, [hit]);
          }
          return out;
        },
        () => new Map(),
      );
      if (lines.size >= KEEP) lines.delete(lines.keys().next().value!);
      lines.set(term, found);
    }
    return found;
  }

  async function properties() {
    const notes = await propertyIndex(ws).notes();
    const props = new Map<string, Map<string, string[]>>();
    for (const [path, note] of notes) {
      const byKey = new Map<string, string[]>();
      for (const p of note.props) byKey.set(p.key.toLowerCase(), Array.isArray(p.value) ? p.value : [String(p.value)]);
      props.set(path, byKey);
    }
    return { props, notes };
  }

  return {
    forget() {
      lines.clear();
      vaultTags(ws).forget();
    },
    /** What `queries` need (and the tags, if `withTags`), or null when they need nothing from the backend. */
    facts(queries: (Query | null)[], withTags = false): Promise<VaultFacts> | null {
      const terms = new Set<string>();
      for (const q of queries) termsOf(q, terms);
      const need = queries.map(needs);
      const wantTags = withTags || need.some((n) => n.tags);
      const wantProps = need.some((n) => n.props);
      if (!terms.size && !wantTags && !wantProps) return null;
      const tags = wantTags ? vaultTags(ws).read().catch(() => new Map<string, string[]>()) : undefined;
      const list = [...terms];
      return Promise.all([Promise.all(list.map(linesOf)), tags, wantProps ? properties() : undefined]).then(([found, t, p]) => {
        const byTerm = new Map(list.map((term, i) => [term, found[i]]));
        return { lines: (term) => byTerm.get(term), tags: t ?? undefined, props: p?.props, notes: p?.notes };
      });
    },
  };
});
