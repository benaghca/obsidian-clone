import { deleteBracketPair } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
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
    enter: () => state.facet(keymap).flat().some((b) => b.key === "Enter" && !!b.run?.(view)), // in keymap order
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

test("Enter in a long note just opened continues a list there, and parses nothing for a plain line", () => {
  const lines = Array.from({ length: 5000 }, (_, i) => (i % 2 ? "" : `Paragraph ${i} with a few words of plain text in it.`));
  lines[4501] = "- item";
  const doc = lines.join("\n");
  const end = (i: number) => lines.slice(0, i + 1).join("\n").length;
  const plain = editor(doc, end(4400));
  const parsed = syntaxTree(plain.state).length;
  expect(parsed).toBeLessThan(end(4000)); // cold: the tree stops well short of the caret
  expect(plain.enter()).toBe(false); // not list markup: the default newline handles it
  expect(syntaxTree(plain.state).length).toBe(parsed);
  const list = editor(doc, end(4501));
  expect(list.enter()).toBe(true);
  expect(list.state.doc.lineAt(list.state.selection.main.head).text).toBe("- ");
});
