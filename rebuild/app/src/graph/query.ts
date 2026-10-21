// The graph's filter and colour-group queries, in Grove's search syntax:
// words are searched for in the notes (every word on one line, as the search
// view does), and Obsidian's operators narrow by place or tag:
//   path:"Projects/Grove"  in that folder (or with that in its path)
//   file:roadmap           the file name contains it
//   tag:#project           tagged #project (or #project/anything)
// Several terms must all match. Pure; the word search itself is done by the
// caller (it needs the backend) and handed in as the set of matching paths.

export interface GraphQuery {
  /** What to search the notes' text for ("" for none). */
  text: string;
  paths: string[];
  files: string[];
  tags: string[];
}

const OPERATOR = /(?:^|\s)(path|file|tag):(?:"([^"]*)"|(\S+))/gi;

export function parseGraphQuery(query: string): GraphQuery {
  const q: GraphQuery = { text: "", paths: [], files: [], tags: [] };
  const text = query.replace(OPERATOR, (_m, op: string, quoted?: string, bare?: string) => {
    const value = (quoted ?? bare ?? "").trim().toLowerCase();
    if (!value) return " ";
    if (op.toLowerCase() === "path") q.paths.push(value.replace(/^\/+|\/+$/g, ""));
    else if (op.toLowerCase() === "file") q.files.push(value);
    else q.tags.push(value.replace(/^#/, ""));
    return " ";
  });
  q.text = text.replace(/\s+/g, " ").trim();
  return q;
}

export const isEmptyQuery = (q: GraphQuery) => !q.text && !q.paths.length && !q.files.length && !q.tags.length;

export interface QueryFacts {
  /** Paths whose text matched `q.text` (only read when there is text). */
  textHits?: ReadonlySet<string>;
  /** Tags per path (only read when the query has tag: terms). */
  tags?: ReadonlyMap<string, readonly string[]>;
}

/** Whether a file passes the query. */
export function matchesQuery(path: string, q: GraphQuery, facts: QueryFacts): boolean {
  const lower = path.toLowerCase();
  if (q.paths.some((p) => !lower.includes(p))) return false;
  const name = lower.slice(lower.lastIndexOf("/") + 1).replace(/\.md$/, "");
  if (q.files.some((f) => !name.includes(f))) return false;
  if (q.tags.length) {
    const tags = (facts.tags?.get(path) ?? []).map((t) => t.toLowerCase());
    if (q.tags.some((want) => !tags.some((t) => t === want || t.startsWith(`${want}/`)))) return false;
  }
  return !q.text || !!facts.textHits?.has(path);
}
