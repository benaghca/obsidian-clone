import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";
import { sourceLines } from "./sourceMode";
import { markdownSyntax } from "./syntax";
import css from "../styles/editor.css?raw";

test("Source mode shares list-line padding, including tasks and nested lists but excluding code", () => {
  const state = EditorState.create({
    doc: "- first\n- [ ] task\n  - nested\n\n1. numbered\n\n```md\n- code\n```",
    extensions: markdownSyntax,
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }] } as unknown as EditorView;
  const lists: number[] = [];
  sourceLines(view).between(0, state.doc.length, (from, _to, d) => {
    if (d.spec.class === "cm-list-line") lists.push(state.doc.lineAt(from).number);
  });
  expect(lists).toEqual([1, 2, 3, 5]);
  expect(css).toMatch(/\.cm-line\.cm-list-line\s*\{[^}]*padding-block:\s*0\.075em;/);
  expect(css).toMatch(/\.is-source-mode \.cm-s-task\s*\{[^}]*line-height:\s*1;/);
});


test("Source headings share their rendered size classes without Live Preview top padding", () => {
  const state = EditorState.create({ doc: "# One\n## Two\n\nSetext\n------\n\n```md\n# code\n```", extensions: markdownSyntax });
  ensureSyntaxTree(state, state.doc.length, 1000);
  const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }] } as unknown as EditorView;
  const headings: [number, string][] = [];
  sourceLines(view).between(0, state.doc.length, (from, _to, d) => {
    if (/^cm-h[1-6]$/.test(d.spec.class)) headings.push([state.doc.lineAt(from).number, d.spec.class]);
  });
  expect(headings).toEqual([[1, "cm-h1"], [2, "cm-h2"], [4, "cm-h2"]]);
  expect(css).toMatch(/\.is-source-mode \.cm-s-heading\s*\{[^}]*font-weight:\s*inherit/);
});
