// The editor settings (Settings → Editor), each in its own CodeMirror
// Compartment. Every note's state is created with the current settings; a
// change reconfigures the states on screen in place (one transaction per
// pane, nothing re-created), and a note that was off screen is brought up to
// date when it is next shown. Extensions are kept per value, so "is this
// state up to date" is an identity check.

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { Compartment, EditorSelection, EditorState, type Extension, Prec, type StateEffect } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { kept } from "../memo";
import { APP, defaults, type SettingsOf } from "../settings/schema";
import { autoConvertHTML } from "./clipboard";
import { backspaceList, closeCodeFence } from "./format";
import { folding } from "./fold";
import { propertiesDisplay } from "./properties";

/** The settings that are the editor's, under their app.json names. */
const KEYS = [
  "showLineNumber", "foldHeading", "foldIndent", "spellcheck", "autoPairBrackets",
  "autoPairMarkdown", "autoConvertHTML", "smartIndentList", "useTab", "tabSize", "propertiesInDocument",
] as const;
export type EditorConfig = Pick<SettingsOf<"app.json">, (typeof KEYS)[number]>;

const NONE: Extension = [];

// Enter on an empty list item ends the list (or steps out one level) without
// leaving a blank line behind, as Obsidian does. CodeMirror's default would
// first turn a tight list loose.
const smartLists = Prec.high(
  keymap.of([
    { key: "Enter", run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
    { key: "Backspace", run: backspaceList },
  ]),
);

const brackets = (pairBrackets: boolean, pairMarkdown: boolean) => [
  EditorState.languageData.of(() => [{ closeBrackets: { brackets: [
    ...(pairBrackets ? ["(", "[", "{", '\"'] : []), ...(pairMarkdown ? ["`", "*"] : []),
  ] } }]),
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
const cached = (key: string, make: () => Extension) => kept(memo, key, make);

/** Pairing shared by the note and its nested cell editors, without block-level Enter commands. */
export function pairingExtensions(c: EditorConfig = current): Extension {
  return cached(`pairs:${c.autoPairBrackets}:${c.autoPairMarkdown}`, () => [
    c.autoPairBrackets || c.autoPairMarkdown ? brackets(c.autoPairBrackets, c.autoPairMarkdown) : NONE,
    c.autoPairMarkdown ? markdownPairs : NONE,
  ]);
}

const PARTS: { compartment: Compartment; ext: (c: EditorConfig) => Extension }[] = [
  { compartment: new Compartment(), ext: (c) => (c.showLineNumber ? cached("lines", () => lineNumbers()) : NONE) },
  {
    compartment: new Compartment(),
    ext: (c) => (c.foldHeading || c.foldIndent ? cached(`fold:${c.foldHeading}:${c.foldIndent}`, () => folding(c.foldHeading, c.foldIndent)) : NONE),
  },
  { compartment: new Compartment(), ext: (c) => cached(`html:${c.autoConvertHTML}`, () => autoConvertHTML.of(c.autoConvertHTML)) },
  { compartment: new Compartment(), ext: (c) => spellcheck[c.spellcheck ? 0 : 1] },
  {
    compartment: new Compartment(), ext: (c) => cached(`typing:${c.autoPairBrackets}:${c.autoPairMarkdown}`, () => [
      pairingExtensions(c),
      c.autoPairMarkdown ? Prec.highest(keymap.of([{ key: "Enter", run: closeCodeFence }])) : NONE,
    ]),
  },
  { compartment: new Compartment(), ext: (c) => (c.smartIndentList ? smartLists : NONE) },
  {
    compartment: new Compartment(),
    ext: (c) =>
      cached(`indent:${c.useTab}:${c.tabSize}`, () => [
        indentUnit.of(c.useTab ? "\t" : " ".repeat(c.tabSize)),
        EditorState.tabSize.of(c.tabSize),
      ]),
  },
  { compartment: new Compartment(), ext: (c) => cached(`properties:${c.propertiesInDocument}`, () => propertiesDisplay.of(c.propertiesInDocument)) },
];

let current: EditorConfig = defaults(APP);

/** Set the editor settings (the app.json settings; the others are left alone). Returns whether any changed. */
export function setEditorConfig(next: EditorConfig): boolean {
  const changed = KEYS.some((k) => next[k] !== current[k]);
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
