// Templates: Insert template with the template's properties merged into the
// note's own, as Obsidian's core Templates plugin does, instead of a second
// `---` block landing at the cursor. The note's existing properties win;
// where both sides hold a list (tags, aliases, any list), the template's
// new items are added after the note's. A template property the note lacks
// is copied in as written, at the end of the note's frontmatter. A note with
// no frontmatter gets the template's block on top. The template's body goes
// in at the cursor (after the frontmatter if the cursor is inside it). The
// note's line endings (CRLF or LF) and BOM are kept; the template's BOM is
// dropped. Every edit is returned in the note's own offsets so one
// transaction (one undo step) applies them all. A frontmatter that can't be
// edited line by line (frontmatter.ts) is never rewritten: only the body
// goes in, and `skipped` says the properties were left out.
// Pure, free of the DOM; tested on its own.

import { readProperties, type Change, type Property } from "./frontmatter";
import { editProperty, lineAt, type Line } from "./propertyEdit";

export interface TemplateMerge {
  /** The edits, in the note's offsets and in order: apply them in one transaction. */
  changes: Change[];
  /** The note after the edits. */
  text: string;
  /** Where the caret goes in `text`: after the inserted body. */
  cursor: number;
  /** The template has properties but the note's frontmatter can't be edited safely: they were left out. */
  skipped: boolean;
}

/** Frontmatter longer than this many lines is left alone, as frontmatter.ts does. */
const MAX_LINES = 2000;

interface Fence {
  open: Line;
  lines: Line[];
  close: Line;
  /** null when the YAML is more than Grove edits line by line. */
  props: Property[] | null;
}

/** The frontmatter at the start of `text` (after a BOM), null if none, "open" if a `---` first line is never closed. */
function fence(text: string): Fence | "open" | null {
  const open = lineAt(text, text.startsWith("﻿") ? 1 : 0);
  if (open.text.trim() !== "---") return null;
  const lines: Line[] = [];
  for (let at = open.end; open.eol && lines.length < MAX_LINES; ) {
    const line = lineAt(text, at);
    if (line.text.trim() === "---") return { open, lines, close: line, props: readProperties(lines.map((l) => l.text)) };
    lines.push(line);
    if (!line.eol) break;
    at = line.end;
  }
  return "open";
}

const closed = (f: Fence | "open" | null): Fence | null => (f && f !== "open" ? f : null);
const sameKey = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const source = (f: Fence, p: Property) => f.lines.slice(p.line, p.line + p.count).map((l) => l.text);
/** Tags match without their `#` and in any case, as Obsidian's tags do; other list items match as written. */
const itemKey = (type: Property["type"], item: string) => (type === "tags" ? item.replace(/^#/, "").toLowerCase() : item);

/** The note's list with the template's new items after it, or null if the template adds none. */
function union(note: Property, template: Property): string[] | null {
  const items = note.value as string[];
  const seen = new Set(items.map((v) => itemKey(note.type, v)));
  const out = [...items];
  for (const v of template.value as string[]) {
    const k = itemKey(note.type, v);
    if (v && !seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out.length > items.length ? out : null;
}

/** Whether the UTF-16 unit at `i` is the second half of a surrogate pair (a change mustn't start or end there). */
const isLow = (s: string, i: number) => i < s.length && s.charCodeAt(i) >= 0xdc00 && s.charCodeAt(i) <= 0xdfff;

/**
 * The template's properties merged into the note's frontmatter: one change
 * inside it, null if there is nothing to add, false if the result didn't
 * read back as intended (the note is then left as it is).
 */
function mergeProperties(note: string, nf: Fence, tf: Fence, eol: string): Change | null | false {
  let text = note;
  /** Every property expected afterwards (lowercased key) and its value. */
  const expected = new Map(nf.props!.map((p) => [p.key.toLowerCase(), JSON.stringify(p.value)]));
  const added: string[] = [];
  for (const tp of tf.props!) {
    const np = nf.props!.find((p) => sameKey(p.key, tp.key));
    if (!np) {
      added.push(...source(tf, tp));
      expected.set(tp.key.toLowerCase(), JSON.stringify(tp.value));
      continue;
    }
    if (np.type === "unknown" || tp.type === "unknown" || !Array.isArray(np.value) || !Array.isArray(tp.value)) continue;
    const value = union(np, tp);
    if (!value) continue;
    // Written in the note's own list style (block or `[a, b]`), indent and line endings.
    const now = closed(fence(text))!;
    const current = now.props!.find((p) => sameKey(p.key, np.key))!;
    const r = editProperty(text, { key: np.key, expect: source(now, current).join("\n"), to: { type: np.type, value } });
    if (r.status !== "done" || !r.change) continue;
    text = text.slice(0, r.change.from) + r.change.insert + text.slice(r.change.to);
    expected.set(np.key.toLowerCase(), JSON.stringify(value));
  }
  if (added.length) {
    const at = closed(fence(text))!.close.from;
    text = text.slice(0, at) + added.map((l) => l + eol).join("") + text.slice(at);
  }
  if (text === note) return null;
  const after = closed(fence(text));
  if (
    !after?.props ||
    after.props.length !== expected.size ||
    after.props.some((p) => expected.get(p.key.toLowerCase()) !== JSON.stringify(p.value)) ||
    text.slice(after.close.end) !== note.slice(nf.close.end)
  )
    return false;
  // Only the lines that changed, between the fences.
  const start = nf.open.end;
  const oldEnd = nf.close.from;
  const newEnd = oldEnd + text.length - note.length;
  let p = 0;
  while (start + p < oldEnd && start + p < newEnd && note[start + p] === text[start + p]) p++;
  if (p && (isLow(note, start + p) || isLow(text, start + p))) p--;
  let s = 0;
  while (oldEnd - s > start + p && newEnd - s > start + p && note[oldEnd - 1 - s] === text[newEnd - 1 - s]) s++;
  if (s && (isLow(note, oldEnd - s) || isLow(text, newEnd - s))) s--;
  return { from: start + p, to: oldEnd - s, insert: text.slice(start + p, newEnd - s) };
}

/**
 * Insert `templateText` (its variables already filled in) into `noteText`
 * over `selection` (default: the end of the note), merging its properties.
 */
export function mergeTemplate(noteText: string, templateText: string, selection = { from: noteText.length, to: noteText.length }): TemplateMerge {
  const template = templateText.replace(/^﻿/, "");
  // A template whose `---` is never closed has no frontmatter (Obsidian's reading): all of it is body.
  const tf = closed(fence(template));
  const found = fence(noteText);
  const nf = closed(found);
  const eol = nf?.open.eol || (noteText.includes("\r\n") ? "\r\n" : "\n");
  const toEol = (s: string) => s.replace(/\r?\n/g, eol);
  const bom = noteText.startsWith("﻿") ? 1 : 0;
  const changes: Change[] = [];
  let skipped = false;

  if (tf && tf.lines.some((l) => l.text.trim())) {
    if (found === null) changes.push({ from: bom, to: bom, insert: ["---", ...tf.lines.map((l) => l.text), "---", ""].join(eol) });
    else if (tf.props?.length === 0) {
      // Only comments: nothing to merge into the note's own.
    } else if (!nf?.props || !tf.props) skipped = true;
    else {
      const change = mergeProperties(noteText, nf, tf, eol);
      if (change === false) skipped = true;
      else if (change) changes.push(change);
    }
  }

  const body = toEol(tf ? template.slice(tf.close.end) : template);
  const earliest = nf ? nf.close.end : bom;
  const from = Math.min(noteText.length, Math.max(selection.from, earliest));
  const to = Math.min(noteText.length, Math.max(selection.to, from));
  // An empty body leaves a selection alone rather than deleting it.
  if (body) changes.push({ from, to, insert: (nf && !nf.close.eol && from === nf.close.end ? eol : "") + body });

  let text = "";
  let pos = 0;
  let delta = 0;
  for (const c of changes) {
    text += noteText.slice(pos, c.from) + c.insert;
    pos = c.to;
    delta += c.insert.length - (c.to - c.from);
  }
  text += noteText.slice(pos);
  return { changes, text, cursor: to + delta, skipped };
}
