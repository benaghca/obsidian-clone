// Live word and character counts for the status bar, of the note's body:
// the frontmatter is left out, as Obsidian leaves it out. A word is a run of
// numbers (a comma or a dot may group digits, so "5,000" is one), letters,
// apostrophes and hyphens stuck together, so a bullet "-" and a rule "---"
// each count and "5,000-line" is one word. CJK ideographs, kana and Tibetan
// letters are one word each. An underscore splits a word. Words never span
// lines, so a single edit only needs the touched lines recounted; a full
// recount is reserved for loading, multi-range edits and edits to the
// frontmatter itself.

import { type EditorState, StateField, type Text } from "@codemirror/state";
import { frontmatterField } from "./frontmatter";

// CJK, kana and Tibetan are one word per character. Split them out first so
// the run below (which treats every letter as part of a word) cannot join them.
const SPLIT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Tibetan}]/gu;
const WORD = /(?:\d+(?:(?:,|\.)\d+)*|[-'’\p{L}\p{M}]+)+/gu;

export function countWords(text: string): number {
  SPLIT.lastIndex = 0;
  const marked = text.replace(SPLIT, " $& ");
  let n = 0;
  WORD.lastIndex = 0;
  while (WORD.exec(marked)) n++;
  return n;
}

function linesAround(doc: Text, from: number, to: number): string {
  return doc.sliceString(doc.lineAt(from).from, doc.lineAt(to).to);
}

export interface Counts {
  words: number;
  chars: number;
}

/** Where the body starts: the line after the frontmatter's closing `---`. */
const bodyFrom = (state: EditorState) => {
  const fm = state.field(frontmatterField, false);
  return fm ? Math.min(fm.end + 1, state.doc.length) : 0;
};

const countAll = (state: EditorState): Counts => {
  const from = bodyFrom(state);
  return { words: countWords(state.doc.sliceString(from)), chars: state.doc.length - from };
};

export const countsField = StateField.define<Counts>({
  create: countAll,
  update(value, tr) {
    if (!tr.docChanged) return value;
    // The frontmatter itself changed (frontmatterField reads it again only then).
    if (tr.state.field(frontmatterField, false) !== tr.startState.field(frontmatterField, false)) return countAll(tr.state);
    let changes = 0;
    tr.changes.iterChangedRanges(() => changes++);
    if (changes !== 1) return countAll(tr.state);
    let words = value.words;
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      words -= countWords(linesAround(tr.startState.doc, fromA, toA));
      words += countWords(linesAround(tr.newDoc, fromB, toB));
    });
    return { words, chars: tr.newDoc.length - bodyFrom(tr.state) };
  },
});
