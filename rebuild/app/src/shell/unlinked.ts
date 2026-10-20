// Unlinked mentions for the Outgoing links view: the names of other notes
// that appear in this note as plain text, not as links, like Obsidian's.
// Pure, so it is tested on its own.
//
// It runs in one pass over the note, whatever the number of notes: the
// text is cut into words once, and each word is looked up in a map from a
// note name's first word to the names that start with it. Fenced code,
// frontmatter, inline code, links, tags and URLs are skipped.

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
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SKIP = [
  /!?\[\[[^\]\n]*\]\]/g, // [[wikilinks]] and embeds
  /!?\[[^\]\n]*\]\([^)\n]*\)/g, // [markdown](links)
  /`[^`\n]*`/g, // inline code
  /(?:https?:\/\/|mailto:|www\.)[^\s)>\]]+/gi, // bare addresses
  /(?<=^|\s)#[\p{L}\p{N}_/-]+/gu, // #tags
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
  const names = indexNames(notes, selfPath);
  if (!names.size) return [];
  const out: UnlinkedMention[] = [];
  const lines = text.split("\n");
  let fence: string | null = null;
  let start = 0;
  // Frontmatter: a first line of "---" up to the next "---".
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && (l.trim() === "---" || l.trim() === "..."));
    if (end > 0) start = end + 1;
  }
  for (let n = start; n < lines.length; n++) {
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
    const taken: [number, number][] = [];
    for (const re of SKIP) for (const m of line.matchAll(re)) taken.push([m.index, m.index + m[0].length]);
    const words = [...line.matchAll(WORD)];
    for (let i = 0; i < words.length; i++) {
      const candidates = names.get(words[i][0].toLowerCase());
      if (!candidates) continue;
      for (const name of candidates) {
        const k = name.words.length;
        if (i + k > words.length) continue;
        let ok = true;
        for (let j = 1; j < k && ok; j++) {
          const prev = words[i + j - 1];
          const cur = words[i + j];
          const between = line.slice(prev.index! + prev[0].length, cur.index);
          ok = cur[0].toLowerCase() === name.words[j] && (name.seps[j - 1] ? between === name.seps[j - 1] : /^\s+$/.test(between));
        }
        if (!ok) continue;
        const from = words[i].index!;
        const to = words[i + k - 1].index! + words[i + k - 1][0].length;
        if (taken.some(([a, b]) => from < b && to > a)) continue;
        out.push({ path: name.path, name: name.name, line: n + 1, from, to, text: line });
        i += k - 1;
        break;
      }
    }
  }
  return out;
}
