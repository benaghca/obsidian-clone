// Finding a note's mentions inside a line of another note, for the
// backlinks view. Pure string work, so it is tested without the DOM.

/** A highlighted range of columns in a line. */
export interface Span {
  from: number;
  to: number;
}

const WIKILINK = /!?\[\[([^\]|#\n]*)(#[^\]|\n]*)?(\|[^\]\n]*)?\]\]/g;
const MD_LINK = /!?\[[^\]\n]*\]\([^)\n]*\)/g;
const TAG = /(?<=^|\s)#[\p{L}\p{N}_/-]+/gu;

/** The [[wikilinks]] in a line whose target is this note. */
export function linkSpans(text: string, isThisNote: (target: string) => boolean): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    if (isThisNote(m[1].trim())) spans.push({ from: m.index, to: m.index + m[0].length });
  }
  return spans;
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Plain-text mentions of a note title: whole words, any case, not already
 * inside a [[link]], a [markdown](link) or a #tag.
 */
export function mentionSpans(text: string, title: string): Span[] {
  if (!title.trim()) return [];
  const taken: Span[] = [];
  for (const re of [WIKILINK, MD_LINK, TAG]) {
    for (const m of text.matchAll(re)) taken.push({ from: m.index, to: m.index + m[0].length });
  }
  const spans: Span[] = [];
  const re = new RegExp(escape(title.trim()).replace(/\s+/g, "\\s+"), "giu");
  for (const m of text.matchAll(re)) {
    const from = m.index;
    const to = from + m[0].length;
    if (isWordChar(text[from - 1]) || isWordChar(text[to])) continue;
    if (taken.some((t) => from < t.to && to > t.from)) continue;
    spans.push({ from, to });
  }
  return spans;
}

/** A list, task or quote marker at the start of a line, which snippets leave out. */
const LEAD = /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|>[ \t]?)*/;

export interface SnippetPart {
  text: string;
  hit: boolean;
}

/**
 * A line cut down for display: leading markers dropped, and when the first
 * hit is far in, the start replaced by an ellipsis so the hit stays visible.
 */
export function snippetParts(text: string, spans: Span[], before = 60): SnippetPart[] {
  const lead = LEAD.exec(text)![0].length;
  let start = lead;
  const first = spans[0];
  if (first && first.from - lead > before) {
    // Start at a word boundary at most `before` characters ahead of the hit.
    const space = text.indexOf(" ", first.from - before);
    start = space >= 0 && space < first.from ? space + 1 : first.from - before;
  }
  const parts: SnippetPart[] = [];
  if (start > lead) parts.push({ text: "…", hit: false });
  let at = start;
  for (const span of spans) {
    if (span.to <= at) continue;
    const from = Math.max(span.from, at);
    if (from > at) parts.push({ text: text.slice(at, from), hit: false });
    parts.push({ text: text.slice(from, span.to), hit: true });
    at = span.to;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts;
}
