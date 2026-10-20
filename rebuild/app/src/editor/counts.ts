// Live word and character counts for the status bar. Words never span lines,
// so a single edit only needs the touched lines recounted; a full recount is
// reserved for loading and multi-range edits.

import { StateField, type Text } from "@codemirror/state";

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

export const countsField = StateField.define<Counts>({
  create: (state) => ({ words: countWords(state.doc.toString()), chars: state.doc.length }),
  update(value, tr) {
    if (!tr.docChanged) return value;
    let changes = 0;
    tr.changes.iterChangedRanges(() => changes++);
    if (changes !== 1) return { words: countWords(tr.newDoc.toString()), chars: tr.newDoc.length };
    let words = value.words;
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      words -= countWords(linesAround(tr.startState.doc, fromA, toA));
      words += countWords(linesAround(tr.newDoc, fromB, toB));
    });
    return { words, chars: tr.newDoc.length };
  },
});
