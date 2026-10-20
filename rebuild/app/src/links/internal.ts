// Internal links: how a new link to a note is written (Settings → Files and
// links: "New link format" and "Use [[Wikilinks]]"), how a link's target
// finds its note, and rewriting the links to a note when it is renamed
// ("Automatically update internal links"). Free of the DOM.

export interface NoteLike {
  name: string;
  path: string;
}

export type LinkFormat = "shortest" | "relative" | "absolute";

export interface LinkStyle {
  format: LinkFormat;
  /** [[wikilinks]]; false writes [markdown](links.md). */
  wikilinks: boolean;
}

const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const stripMd = (path: string) => path.replace(/\.md$/i, "");
const nameOf = (path: string) => stripMd(path.slice(path.lastIndexOf("/") + 1));

/** `to` relative to the folder `fromDir` ("../Other/Note.md"). */
export function relativePath(fromDir: string, to: string): string {
  const from = fromDir ? fromDir.split("/") : [];
  const parts = to.split("/");
  let i = 0;
  while (i < from.length && i < parts.length - 1 && from[i] === parts[i]) i++;
  return [...from.slice(i).map(() => ".."), ...parts.slice(i)].join("/");
}

/** The path part of a new link to `target` from the note at `from` (with .md; wikilinks drop it). */
export function linkPath(target: string, from: string | null, notes: NoteLike[], format: LinkFormat): string {
  if (format === "absolute") return target;
  if (format === "relative") return relativePath(dirOf(from ?? ""), target);
  const name = nameOf(target).toLowerCase();
  const clash = notes.some((n) => n.path !== target && n.name.toLowerCase() === name);
  return clash ? target : target.slice(target.lastIndexOf("/") + 1);
}

/** Markdown link destinations: spaces and brackets percent-encoded, as Obsidian writes them. */
const encodeDest = (path: string) => path.replace(/%/g, "%25").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");

/**
 * A new link to the note at `target` from the note at `from`, in the style
 * the settings ask for. `subpath` is "#Heading" or empty; `display` is the
 * text shown, if different from the note's name.
 */
export function formatLink(target: string, from: string | null, notes: NoteLike[], style: LinkStyle, display?: string, subpath = ""): string {
  const path = linkPath(target, from, notes, style.format);
  if (style.wikilinks) {
    const text = stripMd(path) + subpath;
    return display && display !== text ? `[[${text}|${display}]]` : `[[${text}]]`;
  }
  return `[${display ?? nameOf(target)}](${encodeDest(path)}${subpath.replace(/ /g, "%20")})`;
}

/** Normalise "a/./b/../c" style paths; null if it climbs out of the vault. */
function normalise(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

/**
 * The note a link target points at, as Obsidian resolves it: a path from the
 * vault folder, a path from the linking note's folder, or a note name (any
 * case; with clashes the one nearest the linking note's folder wins).
 * Markdown link destinations may be percent-encoded.
 */
export function resolveLink(target: string, from: string | null, notes: NoteLike[]): string | null {
  let t = target.split("#")[0].trim();
  if (!t) return null;
  try {
    if (/%[0-9a-f]{2}/i.test(t)) t = decodeURIComponent(t);
  } catch {
    // not encoded after all
  }
  const withMd = /\.md$/i.test(t) ? t : `${t}.md`;
  const byPath = new Map(notes.map((n) => [n.path.toLowerCase(), n.path]));
  const fromDir = dirOf(from ?? "");
  if (t.startsWith("./") || t.startsWith("../")) {
    const rel = normalise(`${fromDir}/${withMd}`);
    return rel === null ? null : (byPath.get(rel.toLowerCase()) ?? null);
  }
  const exact = byPath.get(withMd.toLowerCase());
  if (exact) return exact;
  if (t.includes("/")) {
    const rel = normalise(`${fromDir}/${withMd}`);
    const hit = rel === null ? undefined : byPath.get(rel.toLowerCase());
    if (hit) return hit;
    // A partial path: any note whose path ends with it.
    const tail = `/${withMd.toLowerCase()}`;
    return notes.find((n) => `/${n.path.toLowerCase()}`.endsWith(tail))?.path ?? null;
  }
  const name = nameOf(withMd).toLowerCase();
  const matches = notes.filter((n) => n.name.toLowerCase() === name);
  if (matches.length <= 1) return matches[0]?.path ?? null;
  // Several notes share the name: the one in the linking note's folder, else the shallowest.
  return (matches.find((n) => dirOf(n.path) === fromDir) ?? [...matches].sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0]).path;
}

const WIKILINK = /(!?)\[\[([^\]|#\n]*)(#[^\]|\n]*)?(\|[^\]\n]*)?\]\]/g;
const MDLINK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g;

/**
 * Rewrite the links in `text` (the note at `from`) that point at `oldPath`
 * so they point at `newPath`, keeping each link's heading and display text.
 * `before` and `after` are the vault's notes before and after the move.
 * Returns the new text and how many links changed. Code is left alone.
 */
export function rewriteLinks(
  text: string,
  from: string,
  oldPath: string,
  newPath: string,
  before: NoteLike[],
  after: NoteLike[],
  style: LinkStyle,
): { text: string; count: number } {
  let count = 0;
  const lines = text.split("\n");
  let fence: string | null = null;
  const fromAfter = from === oldPath ? newPath : from;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence || (!line.includes("[[") && !line.includes("]("))) continue;
    // Skip inline code spans by blanking them while matching.
    const masked = line.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
    let out = "";
    let last = 0;
    const edits: { at: number; end: number; text: string }[] = [];
    for (const m of masked.matchAll(WIKILINK)) {
      const target = line.slice(m.index! + m[1].length + 2, m.index! + m[1].length + 2 + m[2].length);
      if (!target.trim() || resolveLink(target, from, before) !== oldPath) continue;
      const path = stripMd(linkPath(newPath, fromAfter, after, style.format));
      const rest = line.slice(m.index! + m[1].length + 2 + m[2].length, m.index! + m[0].length);
      edits.push({ at: m.index!, end: m.index! + m[0].length, text: `${m[1]}[[${path}${rest}` });
    }
    for (const m of masked.matchAll(MDLINK)) {
      const dest = line.slice(m.index! + m[0].length - m[3].length - 1, m.index! + m[0].length - 1);
      if (/^[a-z][a-z0-9+.-]*:/i.test(dest)) continue; // a URL
      const hash = dest.indexOf("#");
      const sub = hash < 0 ? "" : dest.slice(hash);
      if (resolveLink(hash < 0 ? dest : dest.slice(0, hash), from, before) !== oldPath) continue;
      const head = line.slice(m.index!, m.index! + m[0].length - m[3].length - 1);
      edits.push({ at: m.index!, end: m.index! + m[0].length, text: `${head}${encodeDest(linkPath(newPath, fromAfter, after, style.format))}${sub})` });
    }
    if (!edits.length) continue;
    edits.sort((a, b) => a.at - b.at);
    for (const e of edits) {
      if (e.at < last) continue;
      out += line.slice(last, e.at) + e.text;
      last = e.end;
      count++;
    }
    lines[i] = out + line.slice(last);
  }
  return { text: lines.join("\n"), count };
}
