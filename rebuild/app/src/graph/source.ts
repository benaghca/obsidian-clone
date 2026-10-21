// What a graph shows: the workspace's notes and attachments (excluded files
// left out) and its link index, through the panel's options, search and
// colour groups. Tags and text-search hits are asked of the backend only
// when the options, the search or a group need them, and are kept until the
// vault changes.

import { api } from "../api";
import type { GraphSettings } from "../settings/schema";
import { createTagReader } from "../shell/vaultTags";
import type { Workspace } from "../workspace";
import { buildGraph, type GraphModel, type GraphNode } from "./data";
import { type GraphQuery, isEmptyQuery, matchesQuery, parseGraphQuery } from "./query";

/** A colour group: the notes and attachments it matches take its colour. */
export interface ColorRule {
  match(node: GraphNode): boolean;
  rgb: number;
}

/** What the backend told us for the graph's queries. */
export interface Facts {
  tags?: Map<string, string[]>;
  /** Paths whose text matches, per search text. */
  hits: Map<string, Set<string>>;
}

const queriesOf = (cfg: GraphSettings) => {
  const query = parseGraphQuery(cfg.search);
  const groups = cfg.colorGroups.map((g) => ({ query: parseGraphQuery(g.query), color: g.color }));
  return { query, groups, all: [query, ...groups.map((g) => g.query)] };
};

export function createGraphSource(ws: Workspace, local: boolean) {
  const readTags = createTagReader(ws);
  let tagCache: Promise<Map<string, string[]>> | null = null;
  const textCache = new Map<string, Promise<Set<string>>>();

  const textHits = (text: string) => {
    let hits = textCache.get(text);
    if (!hits) {
      hits = api.search(text, 100_000).then(
        (list) => new Set(list.map((hit) => hit.path)),
        () => new Set<string>(),
      );
      textCache.set(text, hits);
    }
    return hits;
  };

  return {
    /** Forget what was read: everything (the vault changed), or just the tags. */
    forget(tagsOnly = false) {
      tagCache = null;
      if (!tagsOnly) textCache.clear();
    },

    /** The tags and hits `cfg` needs, or null when it needs none (the graph can then be built at once). */
    facts(cfg: GraphSettings): Promise<Facts> | null {
      const { all } = queriesOf(cfg);
      const needTags = cfg.showTags || all.some((q) => q.tags.length > 0);
      const texts = [...new Set(all.map((q) => q.text).filter(Boolean))];
      if (!needTags && !texts.length) return null;
      if (needTags) tagCache ??= readTags().catch(() => new Map());
      return Promise.all([needTags ? tagCache : undefined, ...texts.map(textHits)]).then(([tags, ...found]) => ({
        tags: tags ?? undefined,
        hits: new Map(texts.map((text, i) => [text, found[i]])),
      }));
    },

    /**
     * The graph for `cfg`: the local graph around `center`, and during the
     * timelapse only the files in `shown`. Each node's colour group comes
     * with it.
     */
    build(cfg: GraphSettings, facts: Facts | null, center: string | null, shown: Set<string> | null): { model: GraphModel; groups: ColorRule[] } {
      const { query, groups } = queriesOf(cfg);
      const tags = facts?.tags;
      const known = (q: GraphQuery) => ({ tags, textHits: facts?.hits.get(q.text) });
      const notes: string[] = [];
      const attachments: string[] = [];
      for (const f of ws.files) {
        if (f.is_dir || ws.isExcluded(f.path)) continue;
        if (f.path.endsWith(".md")) notes.push(f.path);
        else attachments.push(f.path);
      }
      let include = isEmptyQuery(query) ? undefined : (path: string) => path === center || matchesQuery(path, query, known(query));
      if (shown) {
        const base = include;
        include = (path) => shown.has(path) && (!base || base(path));
      }
      const model = buildGraph(
        { notes, attachments, links: ws.links, tags },
        {
          showTags: cfg.showTags,
          showAttachments: cfg.showAttachments,
          hideUnresolved: cfg.hideUnresolved,
          showOrphans: local || cfg.showOrphans,
          include,
          local: local
            ? { center: center ?? "", depth: cfg.localJumps, incoming: cfg.localBacklinks, outgoing: cfg.localForelinks, neighbors: cfg.localInterlinks }
            : undefined,
        },
      );
      return { model, groups: groups.map((g) => ({ match: (n: GraphNode) => !!n.path && matchesQuery(n.path, g.query, known(g.query)), rgb: g.color.rgb })) };
    },
  };
}
