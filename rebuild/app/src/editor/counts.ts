// Live word and character counts for the status bar, of the note's body:
// the frontmatter is left out, as Obsidian leaves it out. Words never span
// lines, so a single edit only needs the touched lines recounted; a full
// recount is reserved for loading, multi-range edits and edits to the
// frontmatter itself.

import { type EditorState, StateField, type Text } from "@codemirror/state";
import { frontmatterField } from "./frontmatter";

const WORD = /[\p{L}\p{N}][\p{L}\p{N}_'’-]*/gu;

export function countWords(text: string): number {
  let n = 0;
  WORD.lastIndex = 0;
  while (WORD.exec(text)) n++;
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
