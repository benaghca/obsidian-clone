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
