import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { countWords, countsField } from "./counts";

test("markdown syntax is not counted as words", () => {
  expect(countWords("- [ ] **Bold** text, don't #tag")).toBe(4);
});

test("incremental counts match a full recount", () => {
  let state = EditorState.create({ doc: "one two\nthree four five\nsix", extensions: countsField });
  const edits = [
    { from: 3, to: 4, insert: "" }, // join "one" and "two"
    { from: 0, to: 0, insert: "new words here\n" },
    { from: 10, to: 30, insert: "x" }, // across lines
    { from: 2, to: 2, insert: " split " },
  ];
  for (const change of edits) {
    state = state.update({ changes: change }).state;
    expect(state.field(countsField)).toEqual({
      words: countWords(state.doc.toString()),
      chars: state.doc.length,
    });
  }
});
