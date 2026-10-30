// Graph data comes from vault files/links, saved tags, and one batched query
// match request. File/path-only filters still build synchronously in TS.
import { api } from "../api";
import type { GraphSettings } from "../settings/schema";
import { matches, needs, parseQuery, termsOf, type Query } from "../shell/searchQuery";
import { vaultTags } from "../shell/vaultTags";
import type { Workspace } from "../workspace";
import { buildGraph, graphFileLists, type GraphModel, type GraphNode } from "./data";

export interface ColorRule {
  match(node: GraphNode): boolean;
  rgb: number;
}
export interface Facts {
  tags?: Map<string, string[]>;
  matched: Map<string, Set<string>>;
}
const NOTHING = { lines: () => undefined };
const needsBackend = (q: Query | null) => {
  const want = needs(q);
  return termsOf(q).size > 0 || want.tags || want.props;
};
const queriesOf = (cfg: GraphSettings) => {
  const query = parseQuery(cfg.search);
  const groups = cfg.colorGroups.map(g => ({ text: g.query, query: parseQuery(g.query), color: g.color }));
  return { query, groups, backend: [...new Set([
    ...(needsBackend(query) ? [cfg.search] : []),
    ...groups.filter(g => needsBackend(g.query)).map(g => g.text),
  ])] };
};

export function createGraphSource(ws: Workspace, local: boolean) {
  let last: { key: string; promise: Promise<Map<string, Set<string>>> } | null = null;
  const tags = vaultTags(ws);
  return {
    forget() { last = null; tags.forget(); },
    facts(cfg: GraphSettings): Promise<Facts> | null {
      const { backend } = queriesOf(cfg);
      if (!backend.length && !cfg.showTags) return null;
      const key = JSON.stringify(backend);
      return ws.editors.flush().then(async () => {
        if (backend.length && last?.key !== key) {
          const pending = api.searchMatch(backend).then(found => new Map(backend.map((q, i) => [q, new Set(found[i])])));
          const entry = { key, promise: pending };
          last = entry;
          void pending.catch(() => { if (last === entry) last = null; });
        }
        const matched = backend.length ? last!.promise : Promise.resolve(new Map<string, Set<string>>());
        const [m, t] = await Promise.all([matched, cfg.showTags ? tags.read() : undefined]);
        return { matched: m, tags: t };
      });
    },
    build(cfg: GraphSettings, facts: Facts | null, center: string | null, shown: Set<string> | null): { model: GraphModel; groups: ColorRule[] } {
      const { query, groups } = queriesOf(cfg);
      const matcher = (text: string, q: Query | null): ((path: string) => boolean) => {
        if (!q) return () => true;
        if (!needsBackend(q)) return path => matches(path, q, NOTHING);
        const found = facts?.matched.get(text);
        return path => found?.has(path) === true;
      };
      const test = matcher(cfg.search, query);
      const { notes, attachments } = graphFileLists(ws.vault.files, path => ws.vault.isExcluded(path));
      let include = query ? (path: string) => path === center || test(path) : undefined;
      if (shown) {
        const base = include;
        include = path => shown.has(path) && (!base || base(path));
      }
      const model = buildGraph(
        { notes, attachments, links: ws.vault.links, tags: facts?.tags },
        {
          showTags: cfg.showTags, showAttachments: cfg.showAttachments,
          hideUnresolved: cfg.hideUnresolved, showOrphans: local || cfg.showOrphans, include,
          local: local ? { center: center ?? "", depth: cfg.localJumps, incoming: cfg.localBacklinks, outgoing: cfg.localForelinks, neighbors: cfg.localInterlinks } : undefined,
        },
      );
      return { model, groups: groups.map(g => {
        const test = matcher(g.text, g.query);
        return { match: n => !!n.path && test(n.path), rgb: g.color.rgb };
      }) };
    },
  };
}
