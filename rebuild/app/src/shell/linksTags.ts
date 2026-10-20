// Pure helpers for the Outgoing links and Tags views (tested without the DOM).

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

/** A line of a note, as the backend's search returns it (1-based line). */
export interface NoteLine {
  path: string;
  line: number;
  text: string;
}

/**
 * Fenced code tracking that matches the backend's index: a fence opens with
 * 3+ backticks or tildes (at most 3 spaces in) and closes on a line of the
 * same marker at least as long. Feed lines in order.
 */
class Fences {
  private open: { marker: string; len: number } | null = null;

  get inside() {
    return this.open !== null;
  }

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

/** Every tag in a note's text, skipping fenced code blocks. */
export function tagsInText(text: string): string[] {
  const out: string[] = [];
  const fences = new Fences();
  for (const line of text.split("\n")) {
    if (fences.step(line) || !line.includes("#")) continue;
    out.push(...tagsInLine(line));
  }
  return out;
}

/**
 * Tags per note from the search hits for "#", skipping lines in fenced code.
 * `fenceLines` are the hits for "```" and "~~~". Only fence lines can change
 * the fence state, so walking them in order gives each note's code ranges
 * without reading its full text.
 */
export function tagsByNote(tagLines: NoteLine[], fenceLines: NoteLine[]): Map<string, string[]> {
  const fencesByPath = new Map<string, NoteLine[]>();
  for (const hit of fenceLines) {
    if (hit.line <= 0) continue;
    const list = fencesByPath.get(hit.path);
    if (list) list.push(hit);
    else fencesByPath.set(hit.path, [hit]);
  }
  /** Per note: [first, last] lines of each fenced block, inclusive, in order. */
  const ranges = new Map<string, [number, number][]>();
  for (const [path, list] of fencesByPath) {
    list.sort((x, y) => x.line - y.line);
    const fences = new Fences();
    const out: [number, number][] = [];
    let start = 0;
    let last = 0;
    for (const hit of list) {
      if (hit.line === last) continue; // the same line found by both markers
      last = hit.line;
      const was = fences.inside;
      fences.step(hit.text);
      if (!was && fences.inside) start = hit.line;
      else if (was && !fences.inside) out.push([start, hit.line]);
    }
    if (fences.inside) out.push([start, Infinity]);
    if (out.length) ranges.set(path, out);
  }
  const tags = new Map<string, string[]>();
  for (const hit of tagLines) {
    if (hit.line <= 0 || !hit.path.endsWith(".md")) continue;
    if (ranges.get(hit.path)?.some(([a, b]) => hit.line >= a && hit.line <= b)) continue;
    const found = tagsInLine(hit.text);
    if (!found.length) continue;
    const list = tags.get(hit.path);
    if (list) list.push(...found);
    else tags.set(hit.path, found);
  }
  return tags;
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
  const node = (tag: string): TagNode => {
    const key = tag.toLowerCase();
    let n = nodes.get(key);
    if (n) return n;
    const slash = tag.lastIndexOf("/");
    n = { tag, name: tag.slice(slash + 1), count: 0, children: [] };
    nodes.set(key, n);
    (slash < 0 ? roots : node(tag.slice(0, slash)).children).push(n);
    return n;
  };
  for (const tag of tags) {
    const parts = tag.split("/");
    for (let i = 1; i <= parts.length; i++) node(parts.slice(0, i).join("/")).count++;
  }
  const sort = (list: TagNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}
