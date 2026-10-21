// Unlinked mentions for the Outgoing links view: the names of other notes
// that appear in this note as plain text, not as links, like Obsidian's.
// Pure, so it is tested on its own.
//
// It runs in one pass over the note, whatever the number of notes: each
// word is looked up in a map from a note name's first word to the names
// that start with it. Fenced code, frontmatter, inline code, links, tags
// and URLs are skipped. It can pause every few hundred lines (a generator),
// so the view spreads a long note over short tasks.

import { splitFrontmatter } from "../editor/frontmatter";
import type { NoteRef } from "../editor/host";

export interface UnlinkedMention {
  /** The note mentioned. */
  path: string;
  name: string;
  /** 1-based line, and the mention's columns in it. */
  line: number;
  from: number;
  to: number;
  /** The whole line, for the snippet. */
  text: string;
}

interface Name {
  path: string;
  name: string;
  /** The name's words, lower case. */
  words: string[];
  /** What sits between consecutive words ("" for any whitespace). */
  seps: string[];
}

const WORD = /[\p{L}\p{N}_]+/gu;
/** At a position: the separator, then the next word. */
const NEXT = /([^\p{L}\p{N}_]*)([\p{L}\p{N}_]+)/uy;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
/** What to skip on a line, each with a cheap test for whether the line can have it at all. */
const SKIP: [RegExp, (line: string) => boolean][] = [
  [/!?\[\[[^\]\n]*\]\]/g, (l) => l.includes("[[")], // [[wikilinks]] and embeds
  [/!?\[[^\]\n]*\]\([^)\n]*\)/g, (l) => l.includes("](")], // [markdown](links)
  [/`[^`\n]*`/g, (l) => l.includes("`")], // inline code
  [/(?:https?:\/\/|mailto:|www\.)[^\s)>\]]+/gi, (l) => l.includes(":") || l.includes("www.")], // bare addresses
  [/(?<=^|\s)#[\p{L}\p{N}_/-]+/gu, (l) => l.includes("#")], // #tags
];

/** Index note names by their first word. Names without a word character can't be mentioned. */
export function indexNames(notes: NoteRef[], selfPath: string | null): Map<string, Name[]> {
  const byFirst = new Map<string, Name[]>();
  const seen = new Set<string>();
  for (const note of notes) {
    if (note.path === selfPath) continue;
    const key = note.name.toLowerCase();
    if (seen.has(key)) continue; // two notes of one name: the first, as links resolve
    seen.add(key);
    const parts = [...note.name.matchAll(WORD)];
    if (!parts.length) continue;
    // Leading or trailing symbols ("C++") must be matched too: keep it simple and skip those.
    if (parts[0].index !== 0 || parts[parts.length - 1].index! + parts[parts.length - 1][0].length !== note.name.length) continue;
    const words = parts.map((m) => m[0].toLowerCase());
    const seps = parts.slice(1).map((m, i) => {
      const between = note.name.slice(parts[i].index! + parts[i][0].length, m.index);
      return /^\s+$/.test(between) ? "" : between;
    });
    const name: Name = { path: note.path, name: note.name, words, seps };
    const list = byFirst.get(words[0]);
    if (list) list.push(name);
    else byFirst.set(words[0], [name]);
  }
  // Longer names first, so "Project roadmap" wins over "Project" at the same place.
  for (const list of byFirst.values()) list.sort((a, b) => b.words.length - a.words.length);
  return byFirst;
}

export function unlinkedMentions(text: string, notes: NoteRef[], selfPath: string | null): UnlinkedMention[] {
  const out: UnlinkedMention[] = [];
  for (const _ of scanUnlinked(text, notes, selfPath, out));
  return out;
}

/**
 * The same, as a generator that pauses every `slice` lines, so a caller can
 * spread a long note over several short tasks. Mentions are pushed to `out`.
 */
export function* scanUnlinked(text: string, notes: NoteRef[], selfPath: string | null, out: UnlinkedMention[], slice = 250): Generator<void> {
  const names = indexNames(notes, selfPath);
  if (!names.size) return;
  const lines = text.split("\n");
  let fence: string | null = null;
  // Frontmatter, read as the Properties block reads it (a "..." line closes none).
  const fm = splitFrontmatter(lines);
  for (let n = fm ? fm.close + 1 : 0; n < lines.length; n++) {
    if (n % slice === slice - 1) yield;
    const line = lines[n];
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    if (!line) continue;
    // Links, code, URLs and tags on the line: only looked for once a name is found on it.
    let taken: [number, number][] | null = null;
    const isTaken = (from: number, to: number) => {
      if (!taken) {
        taken = [];
        for (const [re, can] of SKIP) if (can(line)) for (const m of line.matchAll(re)) taken.push([m.index, m.index + m[0].length]);
      }
      return taken.some(([a, b]) => from < b && to > a);
    };
    // Words are read straight off the (lower-cased) line, no arrays: the next
    // word of a longer name is read with a sticky regex only when needed.
    const lower = line.toLowerCase();
    const src = lower.length === line.length ? lower : line;
    const lowered = src === lower;
    WORD.lastIndex = 0;
    for (let m = WORD.exec(src); m; m = WORD.exec(src)) {
      const candidates = names.get(lowered ? m[0] : m[0].toLowerCase());
      if (!candidates) continue;
      // The words after this one, read once for all candidates, as far as the longest needs.
      const start = m.index;
      const ahead: { sep: string; word: string; end: number }[] = [];
      const word = (j: number) => {
        while (ahead.length < j) {
          NEXT.lastIndex = ahead.length ? ahead[ahead.length - 1].end : start + m![0].length;
          const next = NEXT.exec(src);
          if (!next) return null;
          ahead.push({ sep: next[1], word: lowered ? next[2] : next[2].toLowerCase(), end: NEXT.lastIndex });
        }
        return ahead[j - 1];
      };
      for (const name of candidates) {
        let end = start + m[0].length;
        let ok = true;
        for (let j = 1; j < name.words.length && ok; j++) {
          const next = word(j);
          ok = !!next && next.word === name.words[j] && (name.seps[j - 1] ? next.sep === name.seps[j - 1] : /^\s+$/.test(next.sep));
          if (next) end = next.end;
        }
        if (!ok || isTaken(start, end)) continue;
        out.push({ path: name.path, name: name.name, line: n + 1, from: start, to: end, text: line });
        WORD.lastIndex = end;
        break;
      }
    }
  }
}
