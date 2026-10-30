// Search over a vault of plain text: the reference the parity corpus checks,
// and later the browser mock. A note is any path ending in `.md`, in any
// case. Another file that matches is an attachment (`{}`): no lines, tags
// or properties. Null means the query has nothing to search for (the search
// view shows nothing; the graph treats that as every file and does not ask).

import { readProperties, splitFrontmatter } from "../editor/frontmatter";
import { tagsInText } from "./linksTags";
import { type Facts, highlightsOf, type Line, matchCount, matches, needs, parseQuery, propertyLine, shownLines, termLines } from "./searchQuery";

export interface NoteMatch {
  count: number;
  lines: number[];
}

interface NoteFacts {
  text: string;
  lines?: Line[];
  tags?: string[];
  front?: { props: NonNullable<ReturnType<typeof readProperties>>; lines: string[]; values: Map<string, string[]> } | null;
}

/** The browser mock reuses parsed facts while a file's saved content is unchanged. */
export function createSearchVault() {
  const cache = new Map<string, NoteFacts>();
  return (files: Readonly<Record<string, string>>, query: string, matchCase = false, paths?: readonly string[]) => {
    for (const path of cache.keys()) if (!(path in files)) cache.delete(path);
    const selected = paths ? Object.fromEntries(paths.filter(p => p in files).map(p => [p, files[p]])) : files;
    return searchVault(selected, query, matchCase, cache);
  };
}

const NOTE = /\.md$/i;

/**
 * Lines as Rust's `str::lines` splits them. Split on `\n`, drop a final
 * empty piece, and drop a `\r` only when it was the character before `\n`.
 * A trailing `\r` with no `\n` stays. The caller drops one leading U+FEFF.
 */
function rustLines(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  if (text.endsWith("\n")) parts.pop();
  return parts.map((line, i) => {
    const terminated = i < parts.length - 1 || text.endsWith("\n");
    return terminated && line.endsWith("\r") ? line.slice(0, -1) : line;
  });
}

/** A note's matches, or `{}` for an attachment. Null: nothing to search for. */
export function searchVault(
  files: Readonly<Record<string, string>>,
  query: string,
  matchCase = false,
  cache = new Map<string, NoteFacts>(),
): Record<string, NoteMatch | Record<string, never>> | null {
  const q = parseQuery(query, matchCase);
  if (!q) return null;

  const factsOf = (path: string): NoteFacts => {
    const text = files[path];
    let data = cache.get(path);
    if (!data || data.text !== text) cache.set(path, data = { text });
    return data;
  };
  const source = (path: string) => {
    const text = factsOf(path).text;
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  };
  const paths = Object.keys(files).sort();
  const notes = paths.filter(path => NOTE.test(path));
  const content = (path: string): Line[] => factsOf(path).lines ??=
    rustLines(source(path)).map((text, i) => ({ line: i + 1, text }));

  const byTerm = new Map<string, Map<string, Line[]>>();
  const lines = (term: string) => {
    // file: and path: leaves ask for "" (shownLines). The app never fetches lines for them, so they show none.
    if (!term) return undefined;
    let found = byTerm.get(term);
    if (!found) {
      found = new Map();
      for (const path of notes) {
        const hits = termLines(content(path), term, matchCase);
        if (hits.length) found.set(path, hits);
      }
      byTerm.set(term, found);
    }
    return found;
  };

  const want = needs(q);
  const tags = want.tags ? new Map<string, string[]>() : undefined;
  const props = want.props ? new Map<string, Map<string, string[]>>() : undefined;
  const fronts = new Map<string, { props: readonly { key: string; line: number }[]; lines: readonly string[] }>();
  if (want.tags || want.props) {
    for (const path of notes) {
      const data = factsOf(path);
      if (tags) tags.set(path, data.tags ??= tagsInText(source(path)));
      if (!props) continue;
      if (data.front === undefined) {
        const body = splitFrontmatter(rustLines(source(path)));
        const read = body && readProperties(body.lines);
        data.front = body && read ? {
          props: read, lines: body.lines,
          values: new Map(read.map(p => [p.key.toLowerCase(), Array.isArray(p.value) ? p.value.map(String) : [String(p.value)]])),
        } : null;
      }
      if (!data.front) continue;
      props.set(path, data.front.values);
      fronts.set(path, data.front);
    }
  }

  const facts: Facts = { lines, tags, props, matchCase };
  const out: Record<string, NoteMatch | Record<string, never>> = {};
  for (const path of paths) {
    if (!matches(path, q, facts)) continue;
    if (!NOTE.test(path)) {
      out[path] = {};
      continue;
    }
    const shown = shownLines(path, q, facts, (key) => propertyLine(fronts.get(path), key));
    out[path] = { count: matchCount(shown, highlightsOf(q), matchCase), lines: shown.map((line) => line.line) };
  }
  return out;
}
