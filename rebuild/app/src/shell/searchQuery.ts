// Obsidian's search syntax, for the search view and the graph's filter and
// colour groups (one parser for both). As observed in Obsidian 1.14.4:
//   alpha beta         both words, anywhere in the note (or its name)
//   "star wars"        that phrase
//   -alpha             notes without it (any term or group can be negated)
//   alpha OR beta      either; ( ) groups
//   file:road          the file name contains it
//   path:"Projects/A"  the path contains it ("Search in folder" fills it in)
//   tag:#idea          tagged #idea or #idea/anything
//   line:(a b)         both on one line
//   content:alpha      in the text only, not the name
//   [status]           has the property; [status:draft] its value contains
//                      it ([status:draft OR done] either)
// Matching is case-insensitive. The query is parsed once; what the notes
// contain is handed in as facts: the lines the backend's search found per
// term, the tags per note, the properties per note. Pure, tested on its own.

import { fileName, isUnder, noteName } from "../paths";

export type Field = "any" | "content" | "file" | "path" | "tag";

export type Query =
  | { op: "and" | "or"; parts: Query[] }
  | { op: "not"; part: Query }
  /** A word or phrase, lower case, looked for in `field`. */
  | { op: "term"; text: string; field: Field }
  /** Every term of `part` on one line. */
  | { op: "line"; part: Query }
  /** A property by name; `value`, if given, must match one of its values. */
  | { op: "prop"; key: string; value: Query | null };

const FIELDS = new Set(["file", "path", "tag", "line", "content"]);

/** The query, or null when there is nothing to search for. */
export function parseQuery(input: string): Query | null {
  let at = 0;
  /** Inside [property:...], where "]" ends a word. */
  let inProperty = false;
  const peek = () => input[at];
  const space = () => {
    while (at < input.length && /\s/.test(input[at])) at++;
  };
  // A quoted phrase or a bare word (which ends at a space or a closing bracket).
  const word = (): string => {
    if (peek() === '"') {
      const end = input.indexOf('"', at + 1);
      const text = input.slice(at + 1, end < 0 ? input.length : end);
      at = end < 0 ? input.length : end + 1;
      return text;
    }
    const start = at;
    while (at < input.length && !/[\s()]/.test(input[at]) && !(inProperty && input[at] === "]")) at++;
    return input.slice(start, at);
  };
  const group = (stop: string, field: Field): Query | null => {
    const parts: Query[][] = [[]];
    for (space(); at < input.length && peek() !== stop; space()) {
      const q = unary(field);
      if (q === "OR") parts.push([]);
      else if (q) parts[parts.length - 1].push(q);
    }
    if (peek() === stop) at++;
    const ors = parts.map(all).filter((q): q is Query => !!q);
    return ors.length > 1 ? { op: "or", parts: ors } : (ors[0] ?? null);
  };
  const unary = (field: Field): Query | "OR" | null => {
    if (peek() === ")" || (inProperty && peek() === "]")) {
      at++; // a stray closing bracket
      return null;
    }
    if (input.startsWith("OR", at) && /^[\s)]|^$/.test(input.slice(at + 2, at + 3))) {
      at += 2;
      return "OR";
    }
    if (peek() === "-" && at + 1 < input.length && !/\s/.test(input[at + 1])) {
      at++;
      const q = unary(field);
      return q && q !== "OR" ? { op: "not", part: q } : null;
    }
    if (peek() === "(") {
      at++;
      return group(")", field);
    }
    if (peek() === "[" && input[at + 1] !== "[") return property();
    const op = /^([a-z]+):/i.exec(input.slice(at));
    if (op && FIELDS.has(op[1].toLowerCase())) {
      at += op[0].length;
      const name = op[1].toLowerCase();
      const inner = peek() === "(" ? (at++, group(")", "any")) : term(word(), "any");
      if (!inner) return null;
      return name === "line" ? { op: "line", part: inner } : scoped(inner, name as Field);
    }
    return term(word(), field);
  };
  const property = (): Query | null => {
    at++; // [
    let key = "";
    if (peek() === '"') key = word();
    else while (at < input.length && !/[:\]]/.test(peek())) key += input[at++];
    let value: Query | null = null;
    if (peek() === ":") {
      at++;
      inProperty = true;
      value = group("]", "any");
      inProperty = false;
    } else if (peek() === "]") at++;
    key = key.trim();
    return key ? { op: "prop", key: key.toLowerCase(), value } : null;
  };
  return group("\u0000", "any");
}

const all = (parts: Query[]): Query | null => (parts.length > 1 ? { op: "and", parts } : (parts[0] ?? null));

const term = (text: string, field: Field): Query | null => {
  const t = text.trim().toLowerCase();
  return t ? { op: "term", text: field === "tag" ? t.replace(/^#/, "") : field === "path" ? t.replace(/^\/+|\/+$/g, "") : t, field } : null;
};

/** `file:(a OR b)`: the operator's field given to every term inside. */
function scoped(q: Query, field: Field): Query | null {
  switch (q.op) {
    case "term":
      return term(q.text, field);
    case "not":
      return { op: "not", part: scoped(q.part, field)! };
    case "and":
    case "or":
      return { op: q.op, parts: q.parts.map((p) => scoped(p, field)!).filter(Boolean) };
    default:
      return q;
  }
}

/** The terms, properties and line: groups in a query, depth first, each with whether it sits under a "-". */
function* leaves(q: Query | null, negated = false): Generator<[Extract<Query, { op: "term" | "prop" | "line" }>, boolean]> {
  if (!q) return;
  if ("parts" in q) for (const p of q.parts) yield* leaves(p, negated);
  else if (q.op === "not") yield* leaves(q.part, !negated);
  else yield [q, negated];
}

/** What a term is looked for as in the text (a tag as "#tag"); null for file: and path:, which aren't. */
const textOf = (q: { text: string; field: Field }) => (q.field === "file" || q.field === "path" ? null : q.field === "tag" ? `#${q.text}` : q.text);

/** The words and phrases the backend's search must be asked for (each once), for matching and for showing lines. */
export function termsOf(q: Query | null, out = new Set<string>()): Set<string> {
  for (const [l] of leaves(q)) {
    if (l.op === "line") termsOf(l.part, out);
    else if (l.op === "term" && textOf(l)) out.add(textOf(l)!);
  }
  return out;
}

/** Whether the query needs to know: the notes' tags, their properties. */
export function needs(q: Query | null): { tags: boolean; props: boolean } {
  const all = [...leaves(q)].map(([l]) => l);
  return { tags: all.some((l) => l.op === "term" && l.field === "tag"), props: all.some((l) => l.op === "prop") };
}

/** A line of a note (1-based), as the backend's search returns it. */
export interface Line {
  line: number;
  text: string;
}

export interface Facts {
  /** The lines of each note that contain a term (from termsOf), by path. */
  lines(term: string): ReadonlyMap<string, readonly Line[]> | undefined;
  /** Tags per path (needed for tag: terms). */
  tags?: ReadonlyMap<string, readonly string[]>;
  /** Properties per path, as name → values (needed for [property] terms). */
  props?: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
}

/** Whether a line (or a property's value) holds the query, as text. */
function holds(q: Query, text: string): boolean {
  switch (q.op) {
    case "and":
      return q.parts.every((p) => holds(p, text));
    case "or":
      return q.parts.some((p) => holds(p, text));
    case "not":
      return !holds(q.part, text);
    case "term":
      return text.includes(q.text);
    default:
      return false;
  }
}

/** The lines of a note where a line: group holds. */
function lineHits(path: string, q: Query, facts: Facts): Line[] {
  const seen = new Map<number, Line>();
  for (const t of termsOf(q)) for (const l of facts.lines(t)?.get(path) ?? []) seen.set(l.line, l);
  return [...seen.values()].filter((l) => holds(q, l.text.toLowerCase()));
}

/** Whether a file passes the query. */
export function matches(path: string, q: Query | null, facts: Facts): boolean {
  if (!q) return true;
  switch (q.op) {
    case "and":
      return q.parts.every((p) => matches(path, p, facts));
    case "or":
      return q.parts.some((p) => matches(path, p, facts));
    case "not":
      return !matches(path, q.part, facts);
    case "line":
      return lineHits(path, q.part, facts).length > 0;
    case "prop": {
      const values = facts.props?.get(path)?.get(q.key);
      return !!values && (!q.value || values.some((v) => holds(q.value!, v.toLowerCase())));
    }
  }
  const lower = path.toLowerCase();
  switch (q.field) {
    case "file":
      return fileName(lower).includes(q.text);
    case "path":
      return lower.includes(q.text);
    case "tag":
      return (facts.tags?.get(path) ?? []).some((t) => isUnder(t.toLowerCase(), q.text));
    case "any":
      if (noteName(lower).includes(q.text)) return true;
  }
  return !!facts.lines(q.text)?.get(path)?.length;
}

/**
 * The lines to show for a matching note, in order: lines with the terms it
 * looks for (not the ones it excludes), lines where a line: group holds,
 * and the lines of the properties it asks for (`propLine` gives those).
 */
export function shownLines(path: string, q: Query | null, facts: Facts, propLine: (key: string) => Line | null): Line[] {
  const out = new Map<number, Line>();
  for (const [l, negated] of leaves(q)) {
    if (negated) continue;
    const found = l.op === "line" ? lineHits(path, l.part, facts) : l.op === "prop" ? [matches(path, l, facts) && propLine(l.key)] : (facts.lines(textOf(l) ?? "")?.get(path) ?? []);
    for (const line of found) if (line) out.set(line.line, line);
  }
  return [...out.values()].sort((a, b) => a.line - b.line);
}

/** The words and phrases to highlight in shown lines (lower case, longest first). */
export function highlightsOf(q: Query | null, out = new Set<string>()): string[] {
  for (const [l, negated] of leaves(q)) {
    if (negated) continue;
    if (l.op === "line") highlightsOf(l.part, out);
    else if (l.op === "prop") highlightsOf(l.value, out);
    else if (textOf(l)) out.add(textOf(l)!);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** `path:"folder"` for a folder, quoted when it has spaces, as Obsidian writes it. */
export const pathQuery = (folder: string) => `path:"${folder}" `;
