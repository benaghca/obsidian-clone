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

const NOTE = /\.md$/i;

/**
 * Lines as Rust's `str::lines` splits them. Split on `\n`, drop a final
 * empty piece, and drop a `\r` only when it was the character before `\n`.
 * A trailing `\r` with no `\n` stays. A leading U+FEFF stays on line 1.
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
): Record<string, NoteMatch | Record<string, never>> | null {
  const q = parseQuery(query, matchCase);
  if (!q) return null;

  const source = (path: string) => files[path];
  const paths = Object.keys(files).sort();
  const notes = paths.filter((path) => NOTE.test(path));
  const byPath = new Map<string, Line[]>();
  const content = (path: string): Line[] => {
    let lines = byPath.get(path);
    if (!lines) {
      lines = rustLines(source(path)).map((text, i) => ({ line: i + 1, text }));
      byPath.set(path, lines);
    }
    return lines;
  };

  const byTerm = new Map<string, Map<string, Line[]>>();
  const lines = (term: string) => {
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
      const text = source(path);
      if (tags) tags.set(path, tagsInText(text));
      if (!props) continue;
      const body = splitFrontmatter(rustLines(text));
      if (!body) continue;
      const read = readProperties(body.lines);
      if (!read) continue;
      const byKey = new Map<string, string[]>();
      for (const p of read) byKey.set(p.key.toLowerCase(), Array.isArray(p.value) ? p.value.map(String) : [String(p.value)]);
      props.set(path, byKey);
      fronts.set(path, { props: read, lines: body.lines });
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
