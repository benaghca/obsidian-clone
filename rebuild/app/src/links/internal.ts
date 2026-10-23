// Internal links: how a new link to a note is written (Settings → Files and
// links: "New link format" and "Use [[Wikilinks]]"), how a link's target
// finds its note, and rewriting the links to a note when it is renamed
// ("Automatically update internal links"). Free of the DOM.

import { fileName, parentDir } from "../paths";

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

const stripMd = (path: string) => path.replace(/\.md$/i, "");
const nameOf = (path: string) => stripMd(fileName(path));

/** `to` relative to the folder `fromDir` ("../Other/Note.md"). */
export function relativePath(fromDir: string, to: string): string {
  const from = fromDir ? fromDir.split("/") : [];
  const parts = to.split("/");
  let i = 0;
  while (i < from.length && i < parts.length - 1 && from[i] === parts[i]) i++;
  return [...from.slice(i).map(() => ".."), ...parts.slice(i)].join("/");
}

/** The path part of a new link to `target` from the note at `from` (with .md; wikilinks drop it). */
function linkPath(target: string, from: string | null, notes: NoteLike[], format: LinkFormat): string {
  if (format === "absolute") return target;
  if (format === "relative") return relativePath(parentDir(from ?? ""), target);
  const name = nameOf(target).toLowerCase();
  const clash = notes.some((n) => n.path !== target && n.name.toLowerCase() === name);
  return clash ? target : fileName(target);
}

/** Markdown destinations; renames can retain backslash-escaped parentheses. */
export const encodeDest = (path: string, escaped = false) => path.replace(/%/g, "%25").replace(/ /g, "%20").replace(/\(/g, escaped ? "\\(" : "%28").replace(/\)/g, escaped ? "\\)" : "%29");

/** Backslash escapes in a Markdown destination are syntax, not part of the URL. */
export const markdownURL = (text: string) => text.replace(/\\([\\()])/g, "$1");

/**
 * A new link to the note at `target` from the note at `from`, in the style
 * the settings ask for. `subpath` is "#Heading" or empty; `display` is the
 * text shown, if different from the note's name.
 */
export function formatLink(target: string, from: string | null, notes: NoteLike[], style: LinkStyle, display?: string, subpath = ""): string {
  const path = target ? linkPath(target, from, notes, style.format) : "";
  if (style.wikilinks) {
    const text = stripMd(path) + subpath;
    return display && display !== text ? `[[${text}|${display}]]` : `[[${text}]]`;
  }
  return `[${display ?? (target ? nameOf(target) : subpath.slice(1))}](${encodeDest(path)}${subpath.replace(/ /g, "%20")})`;
}

/** A link target without its #heading, with Markdown escapes and percent encoding decoded. */
function bareTarget(target: string): string {
  const t = markdownURL(target.split("#")[0].trim());
  try {
    return /%[0-9a-f]{2}/i.test(t) ? decodeURIComponent(t) : t;
  } catch {
    return t; // not encoded after all
  }
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
  const t = bareTarget(target);
  if (!t) return null;
  const withMd = /\.md$/i.test(t) ? t : `${t}.md`;
  const byPath = new Map(notes.map((n) => [n.path.toLowerCase(), n.path]));
  // A note's path with or without its ".md"; any other file (an image in an embed) by its full name.
  const find = (path: string | null) => (path === null ? undefined : (byPath.get(`${path}.md`.toLowerCase()) ?? byPath.get(path.toLowerCase())));
  const bare = withMd === t ? t.slice(0, -3) : t;
  const fromDir = parentDir(from ?? "");
  if (t.startsWith("./") || t.startsWith("../")) return find(normalise(`${fromDir}/${bare}`)) ?? null;
  const exact = find(bare);
  if (exact) return exact;
  if (t.includes("/")) {
    const hit = find(normalise(`${fromDir}/${bare}`));
    if (hit) return hit;
    // A partial path: any note (or file) whose path ends with it.
    const tails = [`/${withMd.toLowerCase()}`, `/${t.toLowerCase()}`];
    return notes.find((n) => tails.some((tail) => `/${n.path.toLowerCase()}`.endsWith(tail)))?.path ?? null;
  }
  const name = nameOf(withMd).toLowerCase();
  const matches = notes.filter((n) => n.name.toLowerCase() === name);
  if (matches.length <= 1) return matches[0]?.path ?? null;
  // Several notes share the name: the one in the linking note's folder, else the shallowest.
  return (matches.find((n) => parentDir(n.path) === fromDir) ?? [...matches].sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0]).path;
}

/**
 * A quick test of whether a link target points at a file in the vault (to
 * draw links to missing notes faded): sets of the files' names and paths,
 * made once per file list, so a test costs no scan of the vault. Paths it
 * can't place itself ("../Note", a partial path) go through resolveLink.
 */
export function linkTargets(files: readonly { path: string; is_dir: boolean }[], notes: NoteLike[]) {
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const f of files) {
    if (f.is_dir) continue;
    const lower = f.path.toLowerCase();
    paths.add(lower).add(stripMd(lower));
    names.add(fileName(lower)).add(nameOf(lower));
  }
  return (target: string, from: string | null): boolean => {
    const t = bareTarget(target);
    if (!t) return true; // a heading in the same note
    const lower = t.toLowerCase();
    if (!lower.includes("/")) return names.has(lower);
    return paths.has(lower) || resolveLink(t, from, notes) !== null;
  };
}

const WIKILINK = /(!?)\[\[([^\]|#\n]*)(#[^\]|\n]*)?(\|[^\]\n]*)?\]\]/g;
const MDLINK = /(!?)\[([^\]\n]*)\]\(((?:\\.|[^\\)\s])+)\)/g;

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
  /** Where the linking note is after the move (it may have moved with a folder). */
  fromAfter: string = from === oldPath ? newPath : from,
): { text: string; count: number } {
  let count = 0;
  const lines = text.split("\n");
  let fence: string | null = null;
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
      edits.push({ at: m.index!, end: m.index! + m[0].length, text: `${head}${encodeDest(linkPath(newPath, fromAfter, after, style.format), /\\[()]/.test(dest))}${sub})` });
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
