// What a graph shows: the workspace's notes and attachments (excluded files
// left out) and its link index, through the panel's options, search and
// colour groups (search syntax, shell/searchQuery.ts). Tags, text-search
// hits and properties are asked of the backend only when the options, the
// search or a group need them (shell/searchFacts.ts keeps them until the
// vault changes).

import type { GraphSettings } from "../settings/schema";
import { searchFacts, type VaultFacts } from "../shell/searchFacts";
import { type Facts, matches, parseQuery } from "../shell/searchQuery";
import type { Workspace } from "../workspace";
import { buildGraph, type GraphModel, type GraphNode } from "./data";

/** A colour group: the notes it matches take its colour. */
export interface ColorRule {
  match(node: GraphNode): boolean;
  rgb: number;
}

export type { VaultFacts as Facts };

const NOTHING: Facts = { lines: () => undefined };

const queriesOf = (cfg: GraphSettings) => {
  const query = parseQuery(cfg.search);
  const groups = cfg.colorGroups.map((g) => ({ query: parseQuery(g.query), color: g.color }));
  return { query, groups, all: [query, ...groups.map((g) => g.query)] };
};

export function createGraphSource(ws: Workspace, local: boolean) {
  const shared = searchFacts(ws);
  return {
    /** Forget what was read (the vault changed, or the tags option changed). */
    forget: () => shared.forget(),

    /** The tags and hits `cfg` needs, or null when it needs none (the graph can then be built at once). */
    facts: (cfg: GraphSettings): Promise<VaultFacts> | null => shared.facts(queriesOf(cfg).all, cfg.showTags),

    /**
     * The graph for `cfg`: the local graph around `center`, and during the
     * timelapse only the files in `shown`. Each node's colour group comes
     * with it.
     */
    build(cfg: GraphSettings, facts: VaultFacts | null, center: string | null, shown: Set<string> | null): { model: GraphModel; groups: ColorRule[] } {
      const { query, groups } = queriesOf(cfg);
      const known = facts ?? NOTHING;
      const tags = facts?.tags;
      const notes: string[] = [];
      const attachments: string[] = [];
      for (const f of ws.vault.files) {
        if (f.is_dir || ws.vault.isExcluded(f.path)) continue;
        if (f.path.endsWith(".md")) notes.push(f.path);
        else attachments.push(f.path);
      }
      let include = query ? (path: string) => path === center || matches(path, query, known) : undefined;
      if (shown) {
        const base = include;
        include = (path) => shown.has(path) && (!base || base(path));
      }
      const model = buildGraph(
        { notes, attachments, links: ws.vault.links, tags },
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
      return { model, groups: groups.map((g) => ({ match: (n: GraphNode) => !!n.path && matches(n.path, g.query, known), rgb: g.color.rgb })) };
    },
  };
}
