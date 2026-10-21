// What search queries need to know of the vault, for the search view and
// the graph's filter and groups: the lines the backend's search finds for
// each of their terms, the notes' tags and their properties. Each is asked
// for only when a query uses it, and kept until the vault changes (a
// moment after a save, or a change from outside), so typing a query asks
// the backend only about the term being typed.

import { api } from "../api";
import type { Workspace } from "../workspace";
import { propertyIndex } from "./propertyIndex";
import { type Facts, type Line, needs, type Query, termsOf } from "./searchQuery";
import { createTagReader } from "./vaultTags";

export interface VaultFacts extends Facts {
  tags?: Map<string, string[]>;
}

/** Terms remembered at most (the prefixes of what was typed, mostly). */
const KEEP = 200;

const shared = new WeakMap<Workspace, ReturnType<typeof create>>();

/** The workspace's facts (one cache for every search and graph). */
export function searchFacts(ws: Workspace) {
  let f = shared.get(ws);
  if (!f) shared.set(ws, (f = create(ws)));
  return f;
}

function create(ws: Workspace) {
  const lines = new Map<string, Promise<Map<string, Line[]>>>();
  const readTags = createTagReader(ws);
  let tags: Promise<Map<string, string[]>> | null = null;

  const forget = () => {
    lines.clear();
    tags = null;
  };
  ws.on((change) => {
    if (change === "files" || change === "links") forget();
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
    const out = new Map<string, Map<string, string[]>>();
    for (const [path, { props }] of await propertyIndex(ws).notes()) {
      const byKey = new Map<string, string[]>();
      for (const p of props) byKey.set(p.key.toLowerCase(), Array.isArray(p.value) ? p.value : [String(p.value)]);
      out.set(path, byKey);
    }
    return out;
  }

  return {
    forget,
    /** What `queries` need (and the tags, if `withTags`), or null when they need nothing from the backend. */
    facts(queries: (Query | null)[], withTags = false): Promise<VaultFacts> | null {
      const terms = new Set<string>();
      for (const q of queries) termsOf(q, terms);
      const need = queries.map(needs);
      const wantTags = withTags || need.some((n) => n.tags);
      const wantProps = need.some((n) => n.props);
      if (!terms.size && !wantTags && !wantProps) return null;
      if (wantTags) tags ??= readTags().catch(() => new Map());
      const list = [...terms];
      return Promise.all([Promise.all(list.map(linesOf)), wantTags ? tags : undefined, wantProps ? properties() : undefined]).then(([found, t, props]) => {
        const byTerm = new Map(list.map((term, i) => [term, found[i]]));
        return { lines: (term) => byTerm.get(term), tags: t ?? undefined, props };
      });
    },
  };
}
