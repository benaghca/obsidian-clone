import { EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, test } from "vitest";
import { APP, defaults } from "../settings/schema";
import { configExtensions, setEditorConfig } from "./config";
import { markdownSyntax } from "./syntax";

// Exercise the installed input handlers, falling back to ordinary replacement as the view does.
function editor(doc = "", anchor = doc.length, head = anchor) {
  let state = EditorState.create({ doc, selection: { anchor, head }, extensions: [markdownSyntax, configExtensions()] });
  const view = { get state() { return state; }, dispatch(...specs: TransactionSpec[]) { state = state.update(...specs).state; } } as unknown as EditorView;
  return {
    type(text: string) {
      const { from, to } = state.selection.main;
      const insert = () => state.update(state.replaceSelection(text));
      if (!state.facet(EditorView.inputHandler).some((h) => h(view, from, to, text, insert))) state = insert().state;
      return { doc: state.doc.toString(), anchor: state.selection.main.anchor, head: state.selection.main.head };
    },
  };
}
afterEach(() => setEditorConfig(defaults(APP)));

test("quotes, backticks and stars pair at boundaries, skip closers and stay literal inside words", () => {
  for (const token of ['"', "`", "*"]) {
    const view = editor();
    expect(view.type(token)).toEqual({ doc: token + token, anchor: 1, head: 1 });
    expect(view.type(token)).toEqual({ doc: token + token, anchor: 2, head: 2 });
    expect(editor("word", 2).type(token).doc).toBe(`wo${token}rd`);
    expect(editor("word").type(token).doc).toBe(`word${token}`);
  }
});

test("quotes, brackets and markdown wrap selections without replacing their text", () => {
  for (const [open, close] of [['"', '"'], ["(", ")"], ["[", "]"], ["{", "}"], ["*", "*"], ["`", "`"], ["_", "_"]]) {
    expect(editor("word", 0, 4).type(open)).toEqual({ doc: open + "word" + close, anchor: 1, head: 5 });
    expect(editor("word", 4, 0).type(open)).toEqual({ doc: open + "word" + close, anchor: 5, head: 1 });
  }
});

test("bracket and Markdown pairing settings remain independent", () => {
  setEditorConfig({ ...defaults(APP), autoPairBrackets: false });
  expect(editor().type('"').doc).toBe('"');
  expect(editor().type("*").doc).toBe("**");
  setEditorConfig({ ...defaults(APP), autoPairMarkdown: false });
  expect(editor().type('"').doc).toBe('""');
  expect(editor().type("*").doc).toBe("*");
});
