// Permanent regressions from the round 19 hunter pass.
import { deleteCharBackward, history, redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";
import { backspaceList, indentList } from "./format";
import { Tag, WikiLink } from "./syntax";

function run(cmd: StateCommand, marked: string, unit = "    "): string {
  const anchor = marked.search(/[«|]/);
  const clean = marked.replace(/[«»|]/g, "");
  const head = marked.includes("»") ? marked.indexOf("»") - 1 : anchor;
  let state = EditorState.create({
    doc: clean,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage, extensions: [WikiLink, Tag] }), indentUnit.of(unit)],
  });
  cmd({ state, dispatch: (tr) => { state = tr.state; } });
  const { from, to } = state.selection.main;
  const doc = state.doc.toString();
  return from === to ? doc.slice(0, from) + "|" + doc.slice(from) : doc.slice(0, from) + "«" + doc.slice(from, to) + "»" + doc.slice(to);
}

const backspace: StateCommand = (target) => backspaceList(target) || deleteCharBackward(target as EditorView);

test("Tab moves an ordered item together with its children", () => {
  expect(run(indentList(), "1. a\n2. |b\n    1. child\n3. c")).toBe("1. a\n    1. |b\n        1. child\n2. c");
});

test("Tab with the default tab indent moves the children too", () => {
  expect(run(indentList(), "1. a\n2. |b\n    1. child\n3. c", "\t")).toBe("1. a\n\t1. |b\n\t\t1. child\n2. c");
});

test("Shift+Tab outdents an ordered item together with its children", () => {
  expect(run(indentList(true), "1. a\n    1. |b\n        1. child\n2. c")).toBe("1. a\n2. |b\n    1. child\n3. c");
});

test("Tab indents an ordered item inside the quote", () => {
  expect(run(indentList(), "> 1. first\n> 2. |second\n> 3. third")).toBe("> 1. first\n>     1. |second\n> 2. third");
});

test("Shift+Tab outdents an ordered item inside the quote", () => {
  expect(run(indentList(true), "> 1. first\n>     1. |second\n> 2. third")).toBe("> 1. first\n> 2. |second\n> 3. third");
});

test("Tab indents an ordered item inside a callout", () => {
  expect(run(indentList(), "> [!note] Steps\n> 1. first\n> 2. |second\n> 3. third")).toBe("> [!note] Steps\n> 1. first\n>     1. |second\n> 2. third");
});

test("Backspace in a fence deletes one character", () => {
  expect(run(backspace, "```\n    |code\n```")).toBe("```\n   |code\n```");
});

test("Backspace in frontmatter deletes one character", () => {
  expect(run(backspace, "---\nnested:\n    |value\n---\n\nBody")).toBe("---\nnested:\n   |value\n---\n\nBody");
});

test("the second Backspace in a quoted list outdents one level and keeps the quote", () => {
  const once = run(backspace, "> - parent\n>     - |child");
  expect(once).toBe("> - parent\n>     |child");
  expect(run(backspace, once)).toBe("> - parent\n> |child");
});

test("two list Backspaces are two undo steps", () => {
  const marked = "- a\n    - |nested";
  const anchor = marked.indexOf("|");
  let state = EditorState.create({
    doc: marked.replace("|", ""),
    selection: EditorSelection.cursor(anchor),
    extensions: [markdown({ base: markdownLanguage, extensions: [WikiLink, Tag] }), indentUnit.of("    "), history()],
  });
  const dispatch = (tr: Transaction) => { state = tr.state; };
  backspace({ state, dispatch });
  backspace({ state, dispatch });
  expect(state.doc.toString()).toBe("- a\nnested");
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.doc.toString()).toBe("- a\n    nested");
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.doc.toString()).toBe("- a\n    - nested");
  expect(redo({ state, dispatch })).toBe(true);
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.doc.toString()).toBe("- a\nnested");
});

test("moving a parent preserves a non-default child number", () => {
  expect(run(indentList(), "1. a\n2. |b\n    5. child\n3. c")).toBe("1. a\n    1. |b\n        5. child\n2. c");
  expect(run(indentList(true), "1. a\n    1. |b\n        5. child\n2. c")).toBe("1. a\n2. |b\n    5. child\n3. c");
});

test("a selection including children carries their numbering unchanged", () => {
  expect(run(indentList(), "1. a\n2. «b\n    5. child\n    9. other»\n3. c")).toBe("1. a\n    1. «b\n        5. child\n        9. other»\n2. c");
});

test("default tabs inside quotes still make a full list level", () => {
  expect(run(indentList(), "> 1. first\n> 2. |second\n> 3. third", "\t")).toBe("> 1. first\n>     1. |second\n> 2. third");
});

test("a YAML list marker is text, and quoted tab indentation keeps the quote", () => {
  expect(run(backspace, "---\nitems:\n  - |value\n---")).toBe("---\nitems:\n  -|value\n---");
  expect(run(backspace, "> - parent\n> \t|child", "\t")).toBe("> - parent\n> |child");
});
