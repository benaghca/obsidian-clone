// Pure helpers for the Outgoing links and Tags views (tested without the DOM).

import { splitFrontmatter } from "../editor/frontmatter";
import { kept } from "../memo";
import { compareNames } from "../paths";

const WIKILINK = /!?\[\[([^\]|#^\n]*)(?:[#^][^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g;
const FENCE = /^[ \t]*(```|~~~)/;
/** Obsidian tags: # then letters, digits, _ - /, not only digits, after a space or line start. */
const TAG = /(?<=^|\s)#([\p{L}\p{N}_/-]+)/gu;

/** The [[link]] targets in a note, in order, skipping fenced code blocks. */
export function wikilinkTargets(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line.includes("[[")) continue;
    for (const m of line.matchAll(WIKILINK)) {
      const target = m[1].trim();
      if (target) out.push(target);
    }
  }
  return out;
}

/** The tags on one line of text (without the #). Inline code is skipped. */
export function tagsInLine(line: string): string[] {
  const text = line.replace(/`[^`]*`/g, " ");
  const out: string[] = [];
  for (const m of text.matchAll(TAG)) {
    const tag = m[1].replace(/\/+$/, "");
    if (tag && !/^\d+$/.test(tag)) out.push(tag);
  }
  return out;
}

/**
 * Fenced code tracking (CommonMark's rule): a fence opens with 3+ backticks
 * or tildes (at most 3 spaces in) and closes on a line of the same marker at
 * least as long. Feed lines in order.
 */
class Fences {
  private open: { marker: string; len: number } | null = null;

  /** Step over one line. True when it is a fence line or inside a block (no tags there). */
  step(line: string): boolean {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (this.open) {
      if (m && m[1][0] === this.open.marker && m[1].length >= this.open.len && !m[2].trim()) this.open = null;
      return true;
    }
    if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
      this.open = { marker: m[1][0], len: m[1].length };
      return true;
    }
    return false;
  }
}

/** A note's YAML frontmatter, as far as tags go. */
export interface Frontmatter {
  tags: string[];
  /** The 1-based line of its closing "---" (0: no frontmatter). */
  end: number;
}

const TAG_VALUE = /^[\p{L}\p{N}_/-]+$/u;

/** A frontmatter tag value: quotes and a leading # dropped; null if it isn't a valid tag. */
function tagValue(raw: string): string | null {
  const tag = raw.trim().replace(/^(["'])(.*)\1$/, "$2").trim().replace(/^#/, "").replace(/\/+$/, "");
  return tag && TAG_VALUE.test(tag) && !/^\d+$/.test(tag) ? tag : null;
}

/**
 * The `tags:` (or legacy `tag:`) of a note's frontmatter, in any of
 * Obsidian's forms: a YAML list (`- a`), an inline list (`[a, "#b"]`), or
 * a plain value (`a, b` or `a b`); with or without the #.
 */
export function frontmatterTags(text: string): Frontmatter {
  const fm = text.startsWith("---") ? splitFrontmatter(text) : null;
  return fm ? { tags: parseTags(fm.lines), end: fm.close + 1 } : { tags: [], end: 0 };
}

function parseTags(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(tags?)\s*:(.*)$/i.exec(lines[i]);
    if (!m) continue;
    const value = m[2].replace(/\s+#.*$/, "").trim(); // a YAML comment after the value
    const items: string[] = [];
    if (value.startsWith("[")) items.push(...value.replace(/^\[|\]$/g, "").split(","));
    else if (value) items.push(...value.split(/[,\s]+/));
    else {
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^\s*-\s*(.*)$/.exec(lines[j]);
        if (item) items.push(item[1]);
        else if (lines[j].trim() && !/^\s/.test(lines[j])) break;
      }
    }
    for (const raw of items) {
      const tag = tagValue(raw);
      if (tag) out.push(tag);
    }
  }
  return out;
}

/**
 * Every tag in a note's text: its frontmatter tags, then #tags in the body,
 * skipping fenced code blocks. The backend's tag index (index/tags.rs) is a
 * port of this; fixtures/parity/tags.json holds both to the same cases.
 */
export function tagsInText(text: string): string[] {
  const fm = frontmatterTags(text);
  const out = [...fm.tags];
  const fences = new Fences();
  let n = 0;
  for (const raw of text.split("\n")) {
    if (++n <= fm.end) continue;
    const line = raw.replace(/\r$/, "");
    if (fences.step(line) || !line.includes("#")) continue;
    out.push(...tagsInLine(line));
  }
  return out;
}

export interface TagNode {
  /** The full tag ("project/grove"). */
  tag: string;
  /** The last part ("grove"). */
  name: string;
  /** Uses of this tag and every tag nested under it. */
  count: number;
  children: TagNode[];
}

/**
 * Count tags case-insensitively (the first spelling seen is shown) and nest
 * "a/b" under "a", like Obsidian's tag pane. Sorted by name.
 */
export function tagTree(tags: string[]): TagNode[] {
  const nodes = new Map<string, TagNode>();
  const roots: TagNode[] = [];
  const node = (tag: string): TagNode =>
    kept(nodes, tag.toLowerCase(), () => {
      const slash = tag.lastIndexOf("/");
      const n = { tag, name: tag.slice(slash + 1), count: 0, children: [] };
      (slash < 0 ? roots : node(tag.slice(0, slash)).children).push(n);
      return n;
    });
  for (const tag of tags) {
    const parts = tag.split("/");
    for (let i = 1; i <= parts.length; i++) node(parts.slice(0, i).join("/")).count++;
  }
  const sort = (list: TagNode[]) => {
    list.sort((a, b) => compareNames(a.name, b.name));
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}
