// Internal links: how a new link to a note is written (Settings → Files and
// links: "New link format" and "Use [[Wikilinks]]"), how a link's target
// finds its note, and rewriting the links to a note when it is renamed
// ("Automatically update internal links"). Free of the DOM.

import { fileName, isNoteFile, parentDir } from "../paths";

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

const stripMd = (path: string) => (isNoteFile(path) ? path.slice(0, -3) : path);
const nameOf = (path: string) => stripMd(fileName(path));
/** The whole file name is `.md` in any case. That is not a note and not a link target. */
const namelessMd = (path: string) => fileName(path).toLowerCase() === ".md";

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
  const clash = indexNotes(notes).byName.get(nameOf(target).toLowerCase())?.some((n) => n.path !== target);
  return clash ? target : fileName(target);
}

/** Markdown destinations; renames can retain backslash-escaped parentheses. */
export const encodeDest = (path: string, escaped = false) => path.replace(/%/g, "%25").replace(/ /g, "%20").replace(/\(/g, escaped ? "\\(" : "%28").replace(/\)/g, escaped ? "\\)" : "%29");

/**
 * Spellings of a note name that a rename looks for in other notes: the bare
 * name, spaces written as `%20`, parentheses escaped with a backslash, and
 * both `encodeDest` forms. The same spelling is kept once.
 */
export function linkSpellings(name: string): string[] {
  if (!name) return [];
  return [...new Set([name, name.replace(/ /g, "%20"), name.replace(/[()]/g, "\\$&"), encodeDest(name), encodeDest(name, true)])];
}

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

interface SuffixHit {
  path: string;
  /** Index in the snapshot. The smaller one wins when two tails hit different notes. */
  at: number;
}

interface NoteIndex {
  length: number;
  /** Lowercase path to the original path. Two paths that differ only by case: the later one wins. */
  byPath: Map<string, string>;
  /** `note.name`, lowercased, in the order the notes appear. */
  byName: Map<string, NoteLike[]>;
  /** Slash-aligned suffix of `/${path lower}`, first snapshot note only. */
  bySuffix: Map<string, SuffixHit>;
}

const noteIndexes = new WeakMap<NoteLike[], NoteIndex>();

/**
 * One path and name index for a file snapshot. Callers pass the same array for
 * every link in that snapshot (the mock link index, a rename, the open vault's
 * notes). Building the path map inside each lookup was the cold-open stall.
 * A later push or pop builds the index again; replacing the array always does.
 */
function indexNotes(notes: NoteLike[]): NoteIndex {
  const cached = noteIndexes.get(notes);
  if (cached && cached.length === notes.length) return cached;
  const byPath = new Map<string, string>();
  const byName = new Map<string, NoteLike[]>();
  const bySuffix = new Map<string, SuffixHit>();
  for (let at = 0; at < notes.length; at++) {
    const n = notes[at];
    byPath.set(n.path.toLowerCase(), n.path);
    const key = n.name.toLowerCase();
    const group = byName.get(key);
    if (group) group.push(n);
    else byName.set(key, [n]);
    if (namelessMd(n.path)) continue;
    const padded = `/${n.path.toLowerCase()}`;
    for (let i = 0; i < padded.length; i++) {
      if (padded.charCodeAt(i) !== 47) continue;
      const suffix = padded.slice(i);
      if (!bySuffix.has(suffix)) bySuffix.set(suffix, { path: n.path, at });
    }
  }
  const index = { length: notes.length, byPath, byName, bySuffix };
  noteIndexes.set(notes, index);
  return index;
}

/**
 * The note a link target points at, as Obsidian resolves it: a path from the
 * vault folder, a path from the linking note's folder, or a note name (any
 * case; with clashes the one nearest the linking note's folder wins).
 * Markdown link destinations may be percent-encoded.
 * `index` belongs to `notes` (see `indexNotes`).
 */
function resolveIndexed(index: NoteIndex, target: string, from: string | null): string | null {
  const t = bareTarget(target);
  if (!t) return null;
  const withMd = /\.md$/i.test(t) ? t : `${t}.md`;
  const byPath = index.byPath;
  // A note's path with or without its ".md"; any other file (an image in an embed) by its full name.
  // A file whose whole name is ".md" is skipped.
  const take = (path: string | undefined) => (path && !namelessMd(path) ? path : undefined);
  const find = (path: string | null) => (path === null ? undefined : (take(byPath.get(`${path}.md`.toLowerCase())) ?? take(byPath.get(path.toLowerCase()))));
  const bare = isNoteFile(t) ? t.slice(0, -3) : t;
  const fromDir = parentDir(from ?? "");
  if (t.startsWith("./") || t.startsWith("../")) return find(normalise(`${fromDir}/${bare}`)) ?? null;
  const exact = find(bare);
  if (exact) return exact;
  if (t.includes("/")) {
    const hit = find(normalise(`${fromDir}/${bare}`));
    if (hit) return hit;
    // A partial path: the same ends-with test as before, read from the suffix map.
    // First in the snapshot wins, including when the `.md` tail and the raw tail hit different notes.
    const tails = [`/${withMd.toLowerCase()}`, `/${t.toLowerCase()}`];
    let best: SuffixHit | undefined;
    for (const tail of tails) {
      const found = index.bySuffix.get(tail);
      if (found && (!best || found.at < best.at)) best = found;
    }
    return best?.path ?? null;
  }
  const name = nameOf(withMd).toLowerCase();
  const matches = (index.byName.get(name) ?? []).filter((n) => !namelessMd(n.path));
  if (matches.length <= 1) return matches[0]?.path ?? null;
  // Several notes share the name: the one in the linking note's folder, else the shallowest.
  return (matches.find((n) => parentDir(n.path) === fromDir) ?? [...matches].sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0]).path;
}

/** Resolve every target against one snapshot. The index is built once for `notes`. */
export function linkResolver(notes: NoteLike[]): (target: string, from: string | null) => string | null {
  return (target, from) => resolveIndexed(indexNotes(notes), target, from);
}

export function resolveLink(target: string, from: string | null, notes: NoteLike[]): string | null {
  return resolveIndexed(indexNotes(notes), target, from);
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
    if (f.is_dir || namelessMd(f.path)) continue;
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
/** CommonMark fence: 3+ backticks or tildes, at most three spaces of indent. */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Blank CommonMark inline code on one line (a backtick run closed by a later
 * run of the same length). The result is the same length, so match indexes
 * still point into the original line. An unclosed run is left as written.
 */
function maskInlineCode(line: string): string {
  if (!line.includes("`")) return line;
  const chars = line.split("");
  let i = 0;
  while (i < chars.length) {
    if (chars[i] !== "`") {
      i++;
      continue;
    }
    const start = i;
    while (i < chars.length && chars[i] === "`") i++;
    const n = i - start;
    let j = i;
    let end = -1;
    while (j < chars.length) {
      if (chars[j] !== "`") {
        j++;
        continue;
      }
      const run = j;
      while (j < chars.length && chars[j] === "`") j++;
      if (j - run === n) {
        end = j;
        break;
      }
    }
    if (end >= 0) {
      for (let k = start; k < end; k++) chars[k] = " ";
      i = end;
    }
  }
  return chars.join("");
}

/**
 * Files that moved, for one rewrite pass: old path to new path, with the
 * snapshots a link resolves in before the move and is written against after it.
 */
export interface LinkMoves {
  /** Old path to new path, and the move's place in the order one pass per moved file would apply them. */
  moved: ReadonlyMap<string, { to: string; order: number }>;
  before: NoteLike[];
  after: NoteLike[];
}

/**
 * Rewrite the links in `text` (the note at `from`) that point at `oldPath`
 * so they point at `newPath`, keeping each link's heading and display text.
 * `before` and `after` are the vault's notes before and after the move.
 * Returns the new text and how many links changed. Fenced code (CommonMark:
 * at most three spaces, a closer at least as long, no backtick in a backtick
 * info string) and inline code of any backtick length are left alone.
 * A trailing CR is dropped before the fence pattern, as in `tagsInText`:
 * `.` does not match CR, so a CRLF fence line would otherwise not match.
 *
 * The second form takes every move at once (a folder move): one pass over
 * the text. It writes what one pass per move, in `order`, would have written:
 * a link takes the earliest move it resolves to (in that move's group), and
 * the rewritten link is then offered to the later moves, which may move it
 * again. Each of those steps counts as a changed link, as each pass did.
 * `fromAfter` is where `from` is after the move.
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
  fromAfter?: string,
): { text: string; count: number };
export function rewriteLinks(text: string, from: string, moves: readonly LinkMoves[], style: LinkStyle, fromAfter: string): { text: string; count: number };
export function rewriteLinks(
  text: string,
  from: string,
  ...args: [string, string, NoteLike[], NoteLike[], LinkStyle, string?] | [readonly LinkMoves[], LinkStyle, string]
): { text: string; count: number } {
  let groups: readonly LinkMoves[], style: LinkStyle, fromAfter: string;
  if (args.length === 3) [groups, style, fromAfter] = args;
  else {
    const [oldPath, newPath, before, after] = args;
    groups = [{ moved: new Map([[oldPath, { to: newPath, order: 0 }]]), before, after }];
    style = args[4];
    fromAfter = args[5] ?? (from === oldPath ? newPath : from);
  }
  const indexed = groups.map((g) => ({ ...g, index: indexNotes(g.before) }));
  /** The first move after `after` (in order) that `target` resolves to: the new link path, or null. */
  const next = (target: string, after: number): { path: string; order: number } | null => {
    let best: { to: string; order: number; after: NoteLike[] } | null = null;
    for (const g of indexed) {
      const hit = resolveIndexed(g.index, target, from);
      const m = hit === null ? undefined : g.moved.get(hit);
      if (m && m.order > after && (!best || m.order < best.order)) best = { ...m, after: g.after };
    }
    return best && { path: linkPath(best.to, fromAfter, best.after, style.format), order: best.order };
  };
  let count = 0;
  const lines = text.split("\n");
  let fence: { marker: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\r$/, "");
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence.marker && f[1].length >= fence.len && !f[2].trim()) fence = null;
      continue;
    }
    if (f && !(f[1][0] === "`" && f[2].includes("`"))) {
      fence = { marker: f[1][0], len: f[1].length };
      continue;
    }
    if (!line.includes("[[") && !line.includes("](")) continue;
    // Skip inline code spans by blanking them while matching.
    const masked = maskInlineCode(line);
    let out = "";
    let last = 0;
    const edits: { at: number; end: number; text: string; steps: number }[] = [];
    for (const m of masked.matchAll(WIKILINK)) {
      let target = line.slice(m.index! + m[1].length + 2, m.index! + m[1].length + 2 + m[2].length);
      let steps = 0;
      for (let order = -1; target.trim(); steps++) {
        if (steps && /[\]|#\n]/.test(target)) break; // the next pass would read a different link
        const to = next(target, order);
        if (!to) break;
        target = stripMd(to.path);
        order = to.order;
      }
      if (!steps) continue;
      const rest = line.slice(m.index! + m[1].length + 2 + m[2].length, m.index! + m[0].length);
      edits.push({ at: m.index!, end: m.index! + m[0].length, text: `${m[1]}[[${target}${rest}`, steps });
    }
    for (const m of masked.matchAll(MDLINK)) {
      let dest = line.slice(m.index! + m[0].length - m[3].length - 1, m.index! + m[0].length - 1);
      let steps = 0;
      for (let order = -1; !/^[a-z][a-z0-9+.-]*:/i.test(dest); steps++) { // a URL is not a link
        const hash = dest.indexOf("#");
        const to = next(hash < 0 ? dest : dest.slice(0, hash), order);
        if (!to) break;
        dest = encodeDest(to.path, /\\[()]/.test(dest)) + (hash < 0 ? "" : dest.slice(hash));
        order = to.order;
      }
      if (!steps) continue;
      const head = line.slice(m.index!, m.index! + m[0].length - m[3].length - 1);
      edits.push({ at: m.index!, end: m.index! + m[0].length, text: `${head}${dest})`, steps });
    }
    if (!edits.length) continue;
    edits.sort((a, b) => a.at - b.at);
    for (const e of edits) {
      if (e.at < last) continue;
      out += line.slice(last, e.at) + e.text;
      last = e.end;
      count += e.steps;
    }
    lines[i] = out + line.slice(last) + (raw === line ? "" : "\r");
  }
  return { text: lines.join("\n"), count };
}
