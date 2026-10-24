import { deleteBracketPair } from "@codemirror/autocomplete";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, test } from "vitest";
import { APP, defaults } from "../settings/schema";
import { configExtensions, pairingExtensions, setEditorConfig } from "./config";
import { noteKeymap } from "./editor";
import { cellTransaction } from "./tables";
import { markdownSyntax } from "./syntax";

// Exercise the installed input handlers, falling back to ordinary replacement as the view does.
function editor(doc = "", anchor = doc.length, head = anchor, cell = false) {
  let state = EditorState.create({ doc, selection: { anchor, head }, extensions: cell
    ? [pairingExtensions(), EditorState.transactionFilter.of(cellTransaction)]
    : [markdownSyntax, configExtensions()] });
  const view = { get state() { return state; }, dispatch(...specs: TransactionSpec[]) { state = state.update(...specs).state; } } as unknown as EditorView;
  return {
    get state() { return state; },
    backspace: () => deleteBracketPair(view),
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

test("cell pairing retains closer effects through escaping and respects both settings", () => {
  for (const [open, close] of [['"', '"'], ["`", "`"], ["*", "*"], ["(", ")"], ["[", "]"], ["{", "}"]]) {
    const cell = editor("", 0, 0, true);
    expect(cell.type(open)).toEqual({ doc: open + close, anchor: 1, head: 1 });
    expect(cell.backspace()).toBe(true);
    expect(cell.state.doc.toString()).toBe("");
    cell.type(open);
    cell.type("|"); // escaping shifts the tracked closer by two positions
    expect(cell.type(close)).toEqual({ doc: open + "\\|" + close, anchor: 4, head: 4 });
    expect(editor("word", 0, 4, true).type(open)).toEqual({ doc: open + "word" + close, anchor: 1, head: 5 });
  }
  expect(editor("word", 0, 4, true).type("_").doc).toBe("_word_");
  setEditorConfig({ ...defaults(APP), autoPairMarkdown: false });
  expect(editor("", 0, 0, true).type("*").doc).toBe("*");
  expect(editor("", 0, 0, true).type("`").doc).toBe("`");
  expect(editor("", 0, 0, true).type('"').doc).toBe('""');
  setEditorConfig({ ...defaults(APP), autoPairBrackets: false });
  expect(editor("", 0, 0, true).type('"').doc).toBe('"');
  expect(editor("", 0, 0, true).type("(").doc).toBe("(");
  expect(editor("", 0, 0, true).type("*").doc).toBe("**");
});

test("Alt+Up/Down and Ctrl+Enter are not CodeMirror's line move or blank line", () => {
  const bound = (key: string) => noteKeymap.filter((binding) => binding.key === key);
  expect(bound("Alt-ArrowUp")).toHaveLength(1);
  expect(bound("Alt-ArrowDown")).toHaveLength(1);
  expect(bound("Mod-Enter")).toHaveLength(1);
  expect(bound("Alt-ArrowUp")[0].run?.({} as EditorView)).toBe(true);
  expect(bound("Mod-Enter")[0].run?.({} as EditorView)).toBe(true);
  expect(bound("Shift-Alt-ArrowUp")).toHaveLength(1);
});
