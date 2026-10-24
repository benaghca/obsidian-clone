import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { sampleVault } from "../mock/sampleVault";
import { countWords, countsField } from "./counts";
import { frontmatterField } from "./frontmatter";

const FORMER = /[\p{L}\p{N}][\p{L}\p{N}_'’-]*/gu;

test("markdown syntax is not counted as words, and a bullet hyphen is", () => {
  // The hyphen is a word. Bold, text, don't and tag are the other four.
  expect(countWords("- [ ] **Bold** text, don't #tag")).toBe(5);
});

test("list markers are the words a letter-only count misses", () => {
  // Four bullets, and nothing else Obsidian counts differently: 42 against 38.
  const words = Array.from({ length: 34 }, (_, i) => `w${i}`).join(" ");
  const note = `${words}\n- a\n- b\n- c\n- d`;
  expect(note.match(FORMER)?.length).toBe(38);
  expect(countWords(note)).toBe(42);
});

test("grouped numbers, rules, underscores and CJK match Obsidian", () => {
  expect(countWords("a 5,000-line note")).toBe(3);
  expect(countWords("---")).toBe(1);
  expect(countWords("code_1")).toBe(2);
  expect(countWords("你好")).toBe(2);
  expect(countWords("it’s fine")).toBe(2);
});

test("the sample Welcome note matches Obsidian's word count", () => {
  // The previous counter reported 169 here: five bullet hyphens and the rule
  // were missed, and "5,000-line" was split in two (174 after those cancel).
  const text = sampleVault()["Welcome.md"];
  expect(text.match(FORMER)?.length).toBe(169);
  expect(countWords(text)).toBe(174);
  expect(text.length).toBe(1019);
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
