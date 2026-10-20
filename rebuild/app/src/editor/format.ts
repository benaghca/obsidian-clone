// Editor formatting commands for the Format / Paragraph / Insert menus, the
// command palette and their hotkeys: wrap or unwrap the selection in
// markdown markers, set the kind of the selected lines (heading, list, task,
// quote, body), and insert blocks. Each is a CodeMirror StateCommand, so it
// works on a bare EditorState in tests. They run only when invoked, never as
// part of typing.

import { EditorSelection, type EditorState, type StateCommand, type Transaction, type TransactionSpec } from "@codemirror/state";

type Target = { state: EditorState; dispatch: (tr: Transaction) => void };

const update = (target: Target, spec: TransactionSpec) =>
  target.dispatch(target.state.update(spec, { scrollIntoView: true, userEvent: "input.format" }));

/**
 * Wrap each selection in `marker` (or unwrap it if it already is). With no
 * selection, an empty pair is inserted with the caret inside it, or removed
 * if the caret sits in an empty pair.
 */
export const toggleWrap =
  (marker: string): StateCommand =>
  ({ state, dispatch }) => {
    const m = marker.length;
    // "*" must not unwrap one side of a "**" pair.
    const isMarker = (from: number, to: number) =>
      state.sliceDoc(from, to) === marker &&
      (m > 1 || (state.sliceDoc(from - 1, from) !== marker && state.sliceDoc(to, to + 1) !== marker));
    const changes = state.changeByRange((range) => {
      const { from, to } = range;
      const outside = from >= m && isMarker(from - m, from) && isMarker(to, to + m);
      if (range.empty) {
        if (outside) return { changes: { from: from - m, to: to + m }, range: EditorSelection.cursor(from - m) };
        return { changes: { from, insert: marker + marker }, range: EditorSelection.cursor(from + m) };
      }
      const text = state.sliceDoc(from, to);
      if (text.length >= 2 * m && text.startsWith(marker) && text.endsWith(marker)) {
        return {
          changes: [
            { from, to: from + m },
            { from: to - m, to },
          ],
          range: EditorSelection.range(from, to - 2 * m),
        };
      }
      if (outside) {
        return {
          changes: [
            { from: from - m, to: from },
            { from: to, to: to + m },
          ],
          range: EditorSelection.range(from - m, to - m),
        };
      }
      return {
        changes: [
          { from, insert: marker },
          { from: to, insert: marker },
        ],
        range: EditorSelection.range(from + m, to + m),
      };
    });
    update({ state, dispatch }, changes);
    return true;
  };

/** Markdown inline formatting stripped from the selected text. */
export function stripFormatting(text: string): string {
  return text
    .replace(/(\*\*|__|~~|==|%%)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])([*_])(\S(?:.*?\S)?)\2(?![\w*])/g, "$1$3")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\$([^$\n]+)\$/g, "$1");
}

export const clearFormatting: StateCommand = ({ state, dispatch }) => {
  if (state.selection.ranges.every((r) => r.empty)) return false;
  const changes = state.changeByRange((range) => {
    if (range.empty) return { range };
    const insert = stripFormatting(state.sliceDoc(range.from, range.to));
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(range.from, range.from + insert.length) };
  });
  update({ state, dispatch }, changes);
  return true;
};

export type LineKind = "body" | "bullet" | "numbered" | "task" | "quote" | `h${1 | 2 | 3 | 4 | 5 | 6}`;

// Leading indentation, then at most one block prefix.
const PREFIX = /^([ \t]*)(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+[.)][ \t]+)?/;

function kindOf(prefix: string | undefined): LineKind {
  if (!prefix) return "body";
  if (prefix.startsWith("#")) return `h${prefix.trimEnd().length}` as LineKind;
  if (prefix.startsWith(">")) return "quote";
  if (/^[-*+][ \t]+\[/.test(prefix)) return "task";
  if (/^[-*+]/.test(prefix)) return "bullet";
  return "numbered";
}

/** The lines touched by the selection, each once, in order. */
function selectedLines(state: EditorState) {
  const seen = new Set<number>();
  const lines = [];
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      lines.push(state.doc.line(n));
    }
  }
  return lines.sort((a, b) => a.from - b.from);
}

/**
 * Make the selected lines headings, list items, tasks or quotes (or plain
 * body text). If every line already is that kind, it is toggled off.
 */
export const setLineKind =
  (kind: LineKind): StateCommand =>
  ({ state, dispatch }) => {
    const lines = selectedLines(state);
    const parsed = lines.map((line) => {
      const m = PREFIX.exec(line.text)!;
      return { line, indent: m[1], prefix: m[2] ?? "", kind: kindOf(m[2]) };
    });
    const off = kind !== "body" && parsed.every((p) => p.kind === kind);
    let n = 0;
    const specs = parsed.map(({ line, indent, prefix }) => {
      const target = off ? "body" : kind;
      let insert = "";
      if (target === "bullet") insert = "- ";
      else if (target === "task") insert = "- [ ] ";
      else if (target === "numbered") insert = `${++n}. `;
      else if (target === "quote") insert = "> ";
      else if (target.startsWith("h")) insert = "#".repeat(Number(target.slice(1))) + " ";
      // Headings can't be indented; everything else keeps its indentation.
      const from = target.startsWith("h") ? line.from : line.from + indent.length;
      return { from, to: line.from + indent.length + prefix.length, insert };
    });
    const changes = state.changes(specs);
    const selection = EditorSelection.create(
      state.selection.ranges.map((r) => EditorSelection.range(changes.mapPos(r.anchor, 1), changes.mapPos(r.head, 1))),
      state.selection.mainIndex,
    );
    update({ state, dispatch }, { changes, selection });
    return true;
  };

/** Obsidian's "Toggle checkbox status": plain line → task → checked → unchecked. */
export const toggleCheckbox: StateCommand = ({ state, dispatch }) => {
  const specs = selectedLines(state).map((line) => {
    const m = PREFIX.exec(line.text)!;
    const at = line.from + m[1].length;
    const prefix = m[2] ?? "";
    const kind = kindOf(m[2]);
    if (kind === "task") {
      const box = at + prefix.indexOf("[") + 1;
      return { from: box, to: box + 1, insert: /[xX]/.test(prefix) ? " " : "x" };
    }
    if (kind === "bullet") return { from: at + prefix.length, insert: "[ ] " };
    return { from: at, to: at + prefix.length, insert: "- [ ] " };
  });
  const changes = state.changes(specs);
  const selection = EditorSelection.create(
    state.selection.ranges.map((r) => EditorSelection.range(changes.mapPos(r.anchor, 1), changes.mapPos(r.head, 1))),
    state.selection.mainIndex,
  );
  update({ state, dispatch }, { changes, selection });
  return true;
};

/**
 * Insert a block on its own line: on the caret's line if it is empty,
 * otherwise on a new line after it. `caret` is the offset within `text`
 * where the caret lands.
 */
export const insertBlock =
  (text: string, caret = text.length): StateCommand =>
  ({ state, dispatch }) => {
    const line = state.doc.lineAt(state.selection.main.head);
    const empty = !line.text.trim();
    const from = empty ? line.from : line.to;
    const insert = empty ? text : state.lineBreak + text;
    const offset = empty ? caret : caret + state.lineBreak.length;
    update({ state, dispatch }, { changes: { from, to: empty ? line.to : from, insert }, selection: { anchor: from + offset } });
    return true;
  };

const looksLikeUrl = (text: string) => /^(?:https?:\/\/|mailto:|www\.)\S+$/i.test(text.trim());

/** Ctrl+K: "[selection]()" with the caret in the parentheses, or "[](url)" for a selected address. */
export const insertMarkdownLink: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    if (text && looksLikeUrl(text)) {
      return { changes: { from: range.from, to: range.to, insert: `[](${text})` }, range: EditorSelection.cursor(range.from + 1) };
    }
    const insert = `[${text}]()`;
    const caret = text ? range.from + insert.length - 1 : range.from + 1;
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(caret) };
  });
  update({ state, dispatch }, changes);
  return true;
};

/** "[[selection]]", or an empty "[[]]" with the caret inside for the link suggester. */
export const insertWikilink: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const insert = `[[${text}]]`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: text ? EditorSelection.cursor(range.from + insert.length) : EditorSelection.cursor(range.from + 2),
    };
  });
  update({ state, dispatch }, changes);
  return true;
};

export const BLOCKS = {
  table: { text: "|  |  |\n| --- | --- |\n|  |  |", caret: 2 },
  callout: { text: "> [!NOTE]\n> ", caret: 12 },
  rule: { text: "---\n", caret: 4 },
  codeBlock: { text: "```\n\n```", caret: 4 },
  mathBlock: { text: "$$\n\n$$", caret: 3 },
};

/**
 * Obsidian's "Insert footnote": "[^n]" at the caret, with n one more than
 * the highest footnote in the note, and its "[^n]: " definition on a new
 * line at the end of the note, where the caret goes to write it.
 */
export const insertFootnote: StateCommand = ({ state, dispatch }) => {
  let n = 0;
  for (const m of state.doc.toString().matchAll(/\[\^(\d+)\]/g)) n = Math.max(n, Number(m[1]));
  const label = `[^${n + 1}]`;
  const at = state.selection.main.head;
  const end = state.doc.length;
  const lastLine = state.doc.line(state.doc.lines);
  // The last line as it will be, with the reference in it if the caret is there.
  const last = at >= lastLine.from ? lastLine.text + label : lastLine.text;
  const def = `${last.trim() ? state.lineBreak + state.lineBreak : end ? state.lineBreak : ""}${label}: `;
  update(
    { state, dispatch },
    { changes: [{ from: at, insert: label }, { from: end, insert: def }], selection: { anchor: end + label.length + def.length } },
  );
  return true;
};

/** Replace the selection with text, caret after it (Templates' "Insert current date/time"). */
export const insertText =
  (text: () => string): StateCommand =>
  ({ state, dispatch }) => {
    update({ state, dispatch }, state.replaceSelection(text()));
    return true;
  };
