// A note's YAML frontmatter read as Obsidian's properties, and the edits the
// Properties block (properties.ts) makes to it. Grove reads the subset of
// YAML that properties use: one `key: value` per property, where the value
// is text, a number, true or false, a date, a date and time, or a list
// (`[a, b]` or `- a` lines). Anything else (nested maps, multi-line text,
// anchors, comments inside a value) is a property of unknown type: shown,
// never rewritten. A frontmatter Grove can't read line by line at all is
// shown as source. Each edit replaces only the lines of the property it
// changes, so the rest of the frontmatter stays exactly as written.
// Pure, free of the DOM; tested on its own.

import { StateField, type Text } from "@codemirror/state";

export type PropertyType = "text" | "list" | "number" | "checkbox" | "date" | "datetime" | "tags" | "aliases" | "unknown";

export interface Property {
  /** The key, unquoted. */
  key: string;
  type: PropertyType;
  /** Lists: their items. Checkbox: true/false. Everything else: its text (unknown: its YAML as written). */
  value: string | boolean | string[];
  /** Its lines: index of the key line among the frontmatter's lines, and how many lines it takes. */
  line: number;
  count: number;
}

export interface Frontmatter {
  /** The lines between the opening and closing `---`. */
  lines: string[];
  /** Where each of those lines starts in the note, and where the closing line starts and ends. */
  starts: number[];
  closeFrom: number;
  end: number;
  /** The properties, or null when the YAML is more than Grove can edit safely (shown as source). */
  props: Property[] | null;
}

/** Frontmatter longer than this many lines is left alone, as linksTags does. */
const MAX_LINES = 2000;

/**
 * The frontmatter's lines (and the 0-based line of its closing `---`): a
 * first line of `---`, up to the next `---` (or `...`). Only those lines are
 * read, never a long note's body.
 */
export function splitFrontmatter(text: string | Iterable<string>): { lines: string[]; close: number } | null {
  const out: string[] = [];
  let n = 0;
  for (const raw of typeof text === "string" ? linesOf(text) : text) {
    const line = raw.replace(/\r$/, "");
    if (n === 0 && line.trim() !== "---") return null;
    if (n > 0 && (line.trim() === "---" || line.trim() === "...")) return { lines: out, close: n };
    if (n > 0) out.push(line);
    if (++n > MAX_LINES) return null;
  }
  return null;
}

function* linesOf(text: string) {
  for (let at = 0; ; ) {
    const nl = text.indexOf("\n", at);
    yield nl < 0 ? text.slice(at) : text.slice(at, nl);
    if (nl < 0) return;
    at = nl + 1;
  }
}

/** The note's frontmatter, or null if it has none. */
export function readFrontmatter(doc: Text): Frontmatter | null {
  if (!doc.line(1).text.startsWith("---")) return null;
  const split = splitFrontmatter(doc.iterLines(1, Math.min(doc.lines, MAX_LINES + 1) + 1));
  if (!split) return null;
  const starts = split.lines.map((_, i) => doc.line(i + 2).from);
  const close = doc.line(split.close + 1);
  return { lines: split.lines, starts, closeFrom: close.from, end: close.to, props: readProperties(split.lines) };
}

/** The note's frontmatter, kept up to date cheaply: read again only when an edit touches it. */
export const frontmatterField = StateField.define<Frontmatter | null>({
  create: (state) => readFrontmatter(state.doc),
  update(fm, tr) {
    if (!tr.docChanged) return fm;
    // An edit below it moves nothing (the frontmatter starts the note).
    if (fm && !tr.changes.touchesRange(0, fm.end + 1)) return fm;
    // None yet: one can only start in the first lines.
    const doc = tr.startState.doc;
    if (!fm && !tr.changes.touchesRange(0, doc.line(Math.min(doc.lines, MAX_LINES + 1)).to)) return fm;
    return readFrontmatter(tr.state.doc);
  },
});

// ----- reading -----

const KEY_LINE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#\-?:,[\]{}&*!|>'"%@`][^:]*?)[ \t]*:(?:[ \t]+(.*?))?[ \t]*$/;
const ITEM_LINE = /^([ \t]*)-(?:[ \t]+(.*?))?[ \t]*$/;
const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

type Scalar = { kind: "string" | "number" | "bool" | "null" | "date" | "datetime"; text: string };

/** One YAML scalar on one line, or null if it is anything more (a map, a block, an anchor, a comment). */
function scalar(raw: string): Scalar | null {
  const v = raw.trim();
  if (!v || v === "~" || /^null$/i.test(v)) return { kind: "null", text: "" };
  if (v.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(v)) return null;
    try {
      return { kind: "string", text: JSON.parse(v) as string };
    } catch {
      return null;
    }
  }
  if (v.startsWith("'")) return /^'(?:[^']|'')*'$/.test(v) ? { kind: "string", text: v.slice(1, -1).replace(/''/g, "'") } : null;
  if (/^[[\]{}&*!|>%@`#]/.test(v) || /:(\s|$)|\s#/.test(v)) return null;
  if (/^(true|false)$/i.test(v)) return { kind: "bool", text: v.toLowerCase() };
  if (NUMBER.test(v)) return { kind: "number", text: v };
  if (DATE.test(v)) return { kind: "date", text: v };
  if (DATETIME.test(v)) return { kind: "datetime", text: v };
  return { kind: "string", text: v };
}

/** `[a, "b, c"]` on one line: its items, or null if any is more than a scalar. */
function flowList(v: string): string[] | null {
  if (!/^\[.*\]$/.test(v)) return null;
  const body = v.slice(1, -1);
  if (!body.trim()) return [];
  const items: string[] = [];
  let item = "";
  let quote = "";
  for (const ch of body) {
    if (quote) {
      item += ch;
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      item += ch;
      quote = ch;
    } else if (ch === ",") {
      items.push(item);
      item = "";
    } else item += ch;
  }
  if (quote) return null;
  items.push(item);
  const out: string[] = [];
  for (const raw of items) {
    const s = scalar(raw);
    if (!s) return null;
    if (s.kind !== "null") out.push(s.text);
  }
  return out;
}

/** The type Obsidian gives a key whatever its value. */
const KEY_TYPES: Record<string, PropertyType> = { tags: "tags", aliases: "aliases", cssclasses: "list" };

function property(key: string, inline: string | undefined, rest: string[], line: number): Property {
  const count = 1 + rest.length;
  const unknown = (): Property => ({ key, type: "unknown", value: [inline ?? "", ...rest].join("\n").trim(), line, count });
  const keyType = KEY_TYPES[key.toLowerCase()];
  let items: string[] | null = null;
  let single: Scalar | null = null;
  const body = rest.filter((l) => l.trim());
  if (inline !== undefined && inline !== "") {
    if (body.length) return unknown();
    items = flowList(inline);
    if (!items) {
      single = scalar(inline);
      if (!single) return unknown();
    }
  } else if (body.length) {
    const first = ITEM_LINE.exec(body[0]);
    if (!first) return unknown();
    items = [];
    for (const l of body) {
      const m = ITEM_LINE.exec(l);
      if (!m || m[1] !== first[1]) return unknown();
      const s = scalar(m[2] ?? "");
      if (!s) return unknown();
      if (s.kind !== "null") items.push(s.text);
    }
  } else single = { kind: "null", text: "" };

  if (keyType) {
    if (!items) {
      const text = single!.text;
      // A plain value: tags split at commas and spaces (Obsidian's reading), an alias stays whole.
      items = !text ? [] : keyType === "tags" ? text.split(/[,\s]+/).filter(Boolean) : [text];
    }
    return { key, type: keyType, value: items, line, count };
  }
  if (items) return { key, type: "list", value: items, line, count };
  const s = single!;
  const type: PropertyType = s.kind === "bool" ? "checkbox" : s.kind === "number" ? "number" : s.kind === "date" ? "date" : s.kind === "datetime" ? "datetime" : "text";
  return { key, type, value: s.kind === "bool" ? s.text === "true" : s.text, line, count };
}

/** A YAML comment on a line (outside quotes): an edit would lose it. */
const hasComment = (line: string) => /(^|\s)#/.test(line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, '""'));

/** The properties in a frontmatter's lines, or null if a line isn't one Grove can place. */
export function readProperties(lines: readonly string[]): Property[] | null {
  const props: Property[] = [];
  const continues = (j: number) => /^[ \t]/.test(lines[j]) || /^-([ \t]|$)/.test(lines[j]);
  let i = 0;
  while (i < lines.length) {
    // Blank lines and comments between properties belong to none: never touched.
    if (!lines[i].trim() || lines[i].startsWith("#")) {
      i++;
      continue;
    }
    const m = KEY_LINE.exec(lines[i]);
    const key = m && unquoteKey(m[1]);
    if (!m || key === null) return null;
    // The lines under the key: indented ones, `- item` ones, and blank ones between those.
    let j = i + 1;
    for (let k = j; k < lines.length; k++) {
      if (!lines[k].trim()) continue;
      if (!continues(k)) break;
      j = k + 1;
    }
    const rest = lines.slice(i + 1, j);
    props.push(
      (m[2] && hasComment(m[2])) || rest.some(hasComment)
        ? { key, type: "unknown", value: [m[2] ?? "", ...rest].join("\n").trim(), line: i, count: j - i }
        : property(key, m[2], rest, i),
    );
    i = j;
  }
  return props;
}

function unquoteKey(raw: string): string | null {
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return null;
    }
  }
  return raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw.trim();
}

// ----- writing -----

/** A string as a YAML scalar: plain when that reads back as the same text, double-quoted otherwise. */
export function yamlString(s: string): string {
  if (s === "") return '""';
  const plain =
    s === s.trim() &&
    !/[\n\r\t]/.test(s) &&
    !/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) &&
    !/:(\s|$)|\s#/.test(s) &&
    scalar(s)?.kind === "string";
  return plain ? s : JSON.stringify(s);
}

/** A key as YAML: plain when that reads back as the same key, double-quoted otherwise. */
const yamlKey = (key: string) => (/^[^\s#\-?:,[\]{}&*!|>'"%@`][^:]*$/.test(key) && key === key.trim() && !/\s#/.test(key) ? key : JSON.stringify(key));

/** A property's lines as Grove writes them (Obsidian's style: lists as `  - item` lines). */
export function formatProperty(key: string, type: PropertyType, value: Property["value"]): string {
  const k = yamlKey(key);
  if (Array.isArray(value)) return value.length ? [`${k}:`, ...value.map((v) => `  - ${yamlString(v)}`)].join("\n") : `${k}: []`;
  if (typeof value === "boolean") return `${k}: ${value}`;
  if (value === "") return `${k}:`;
  // Numbers, dates and times are written as typed (the inputs only produce valid ones).
  const raw = type === "number" || type === "date" || type === "datetime";
  return `${k}: ${raw ? value : yamlString(value)}`;
}

export interface Change {
  from: number;
  to: number;
  insert: string;
}

const lastLineEnd = (fm: Frontmatter, p: Property) => fm.starts[p.line + p.count - 1] + fm.lines[p.line + p.count - 1].length;
/** The key as written on a property's line (quoted or not). */
const writtenKey = (fm: Frontmatter, p: Property) => KEY_LINE.exec(fm.lines[p.line])![1];

/** Set a property's value: its lines are replaced, the key kept as written. */
export function setValue(fm: Frontmatter, p: Property, value: Property["value"]): Change {
  const lines = formatProperty(p.key, p.type, value);
  const insert = writtenKey(fm, p) + lines.slice(lines.indexOf(":", yamlKey(p.key).length));
  return { from: fm.starts[p.line], to: lastLineEnd(fm, p), insert };
}

/** Rename a property: only its key changes. */
export function renameKey(fm: Frontmatter, p: Property, key: string): Change {
  const from = fm.starts[p.line];
  return { from, to: from + writtenKey(fm, p).length, insert: yamlKey(key) };
}

/** Remove a property and its lines. */
export function removeProperty(fm: Frontmatter, p: Property): Change {
  const next = p.line + p.count;
  return { from: fm.starts[p.line], to: next < fm.lines.length ? fm.starts[next] : fm.closeFrom, insert: "" };
}

/** Add a property at the end of the frontmatter (a new frontmatter if the note has none). */
export function addProperty(fm: Frontmatter | null, key: string, type: PropertyType = "text", value: Property["value"] = ""): Change {
  const line = formatProperty(key, type, value);
  return fm ? { from: fm.closeFrom, to: fm.closeFrom, insert: `${line}\n` } : { from: 0, to: 0, insert: `---\n${line}\n---\n` };
}
