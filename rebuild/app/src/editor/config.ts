// The editor settings (Settings → Editor), each in its own CodeMirror
// Compartment. Every note's state is created with the current settings; a
// change reconfigures the states on screen in place (one transaction per
// pane, nothing re-created), and a note that was off screen is brought up to
// date when it is next shown. Extensions are kept per value, so "is this
// state up to date" is an identity check.

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { Compartment, EditorSelection, EditorState, type Extension, Prec, type StateEffect } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { folding } from "./fold";

export interface EditorConfig {
  lineNumbers: boolean;
  foldHeading: boolean;
  foldIndent: boolean;
  spellcheck: boolean;
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
  smartLists: boolean;
  useTab: boolean;
  tabSize: number;
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  lineNumbers: false,
  foldHeading: true,
  foldIndent: true,
  spellcheck: true,
  autoPairBrackets: true,
  autoPairMarkdown: true,
  smartLists: true,
  useTab: true,
  tabSize: 4,
};

const NONE: Extension = [];

// Enter on an empty list item ends the list (or steps out one level) without
// leaving a blank line behind, as Obsidian does. CodeMirror's default would
// first turn a tight list loose.
const smartLists = Prec.high(
  keymap.of([
    { key: "Enter", run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
    { key: "Backspace", run: deleteMarkupBackward },
  ]),
);

const brackets = [
  EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{"] } }]),
  closeBrackets(),
  keymap.of(closeBracketsKeymap),
];

// Obsidian's "Auto-pair Markdown syntax": typing one of these with text
// selected wraps the selection in it and keeps it selected, so ** around a
// word is two key presses.
const MARKDOWN_PAIRS = "*_`=~$";
const markdownPairs = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (text.length !== 1 || !MARKDOWN_PAIRS.includes(text)) return false;
  const { state } = view;
  if (state.readOnly || state.selection.ranges.every((r) => r.empty)) return false;
  view.dispatch(
    state.changeByRange((r) =>
      r.empty
        ? { changes: { from: r.from, insert: text }, range: EditorSelection.cursor(r.from + 1) }
        : {
            changes: [
              { from: r.from, insert: text },
              { from: r.to, insert: text },
            ],
            range: EditorSelection.range(r.anchor + 1, r.head + 1),
          },
    ),
    { userEvent: "input.type", scrollIntoView: true },
  );
  return true;
});

const spellcheck = [true, false].map((on) =>
  EditorView.contentAttributes.of({
    spellcheck: String(on),
    autocorrect: on ? "on" : "off",
    autocapitalize: on ? "sentences" : "off",
  }),
);

const memo = new Map<string, Extension>();
const cached = (key: string, make: () => Extension) => {
  let ext = memo.get(key);
  if (!ext) memo.set(key, (ext = make()));
  return ext;
};

const PARTS: { compartment: Compartment; ext: (c: EditorConfig) => Extension }[] = [
  { compartment: new Compartment(), ext: (c) => (c.lineNumbers ? cached("lines", () => lineNumbers()) : NONE) },
  {
    compartment: new Compartment(),
    ext: (c) => (c.foldHeading || c.foldIndent ? cached(`fold:${c.foldHeading}:${c.foldIndent}`, () => folding(c.foldHeading, c.foldIndent)) : NONE),
  },
  { compartment: new Compartment(), ext: (c) => spellcheck[c.spellcheck ? 0 : 1] },
  { compartment: new Compartment(), ext: (c) => (c.autoPairBrackets ? brackets : NONE) },
  { compartment: new Compartment(), ext: (c) => (c.autoPairMarkdown ? markdownPairs : NONE) },
  { compartment: new Compartment(), ext: (c) => (c.smartLists ? smartLists : NONE) },
  {
    compartment: new Compartment(),
    ext: (c) =>
      cached(`indent:${c.useTab}:${c.tabSize}`, () => [
        indentUnit.of(c.useTab ? "\t" : " ".repeat(c.tabSize)),
        EditorState.tabSize.of(c.tabSize),
      ]),
  },
];

let current: EditorConfig = { ...DEFAULT_EDITOR_CONFIG };

export const editorConfig = () => current;

/** Set the editor settings. Returns whether anything changed. */
export function setEditorConfig(next: EditorConfig): boolean {
  const changed = (Object.keys(next) as (keyof EditorConfig)[]).some((k) => next[k] !== current[k]);
  current = { ...next };
  return changed;
}

/** The settings' extensions for a new note state. */
export function configExtensions(): Extension {
  return PARTS.map((p) => p.compartment.of(p.ext(current)));
}

/** What a state needs to match the current settings (nothing if it already does). */
export function configEffects(state: EditorState): StateEffect<unknown>[] {
  const effects: StateEffect<unknown>[] = [];
  for (const p of PARTS) {
    const want = p.ext(current);
    if (p.compartment.get(state) !== want) effects.push(p.compartment.reconfigure(want));
  }
  return effects;
}
