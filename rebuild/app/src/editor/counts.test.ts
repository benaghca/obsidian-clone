import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { countWords, countsField } from "./counts";
import { frontmatterField } from "./frontmatter";

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

test("the frontmatter is left out, as in Obsidian, also while it or the body is edited", () => {
  // Obsidian 1.14.4: "---\na: 1\n---\n\nabc def\n" is 2 words, 9 characters.
  let state = EditorState.create({ doc: "---\na: 1\n---\n\nabc def\n", extensions: [frontmatterField, countsField] });
  expect(state.field(countsField)).toEqual({ words: 2, chars: 9 });
  const recount = (s: EditorState) => {
    const body = s.doc.toString().replace(/^---\n[^]*?\n---\n/, "");
    return { words: countWords(body), chars: body.length };
  };
  for (const change of [{ from: 15, insert: "more words " }, { from: 4, insert: "b: two words\n" }, { from: 0, insert: "x" }, { from: 0, to: 1 }]) {
    state = state.update({ changes: change }).state;
    expect(state.field(countsField)).toEqual(state.field(frontmatterField) ? recount(state) : { words: countWords(state.doc.toString()), chars: state.doc.length });
  }
});
