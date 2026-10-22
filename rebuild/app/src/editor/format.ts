// Editor formatting commands for the Format / Paragraph / Insert menus, the
// command palette and their hotkeys: wrap or unwrap the selection in
// markdown markers, set the kind of the selected lines (heading, list, task,
// quote, body), and insert blocks. Each is a CodeMirror StateCommand, so it
// works on a bare EditorState in tests. They run only when invoked, never as
// part of typing.

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type StateCommand, type Transaction, type TransactionSpec } from "@codemirror/state";

type Target = { state: EditorState; dispatch: (tr: Transaction) => void };

const update = (target: Target, spec: TransactionSpec) =>
  target.dispatch(target.state.update(spec, { scrollIntoView: true, userEvent: "input.format" }));

/**
 * Wrap each selection in `marker` (or unwrap it if it already is). With no
 * selection, the word around an interior caret is formatted; elsewhere an
 * empty pair is inserted with the caret inside it, or removed if already empty.
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
      const word = range.empty ? state.wordAt(range.head) : null;
      const target = word && word.from < range.head && range.head < word.to ? word : range;
      const { from, to } = target;
      const outside = from >= m && isMarker(from - m, from) && isMarker(to, to + m);
      if (target.empty) {
        if (outside) return { changes: { from: from - m, to: to + m }, range: EditorSelection.cursor(from - m) };
        return { changes: { from, insert: marker + marker }, range: EditorSelection.cursor(from + m) };
      }
      const text = state.sliceDoc(from, to);
      const inside = text.length >= 2 * m && text.startsWith(marker) && text.endsWith(marker);
      // The markers inside the selection come off, or those around it, or it is wrapped; it keeps its text.
      const set = state.changes(
        inside ? [{ from, to: from + m }, { from: to - m, to }]
        : outside ? [{ from: from - m, to: from }, { from: to, to: to + m }]
        : [{ from, insert: marker }, { from: to, insert: marker }],
      );
      return { changes: set, range: range.empty ? EditorSelection.cursor(set.mapPos(range.head, 1)) : EditorSelection.range(set.mapPos(from, 1), set.mapPos(to, -1)) };
    });
    update({ state, dispatch }, changes);
    return true;
  };

/** Obsidian's coloured highlights (1.14.4): an emoji just inside the opening ==, ==🔴like this==. */
export const HIGHLIGHT_COLORS = { red: "🔴", orange: "🟠", yellow: "🟡", green: "🟢", blue: "🔵", purple: "🟣" };
export type HighlightColor = keyof typeof HIGHLIGHT_COLORS;

/** The colour a highlight's text starts with (its emoji), or null. */
export const highlightColor = (text: string) =>
  (Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]).find((c) => text.startsWith(HIGHLIGHT_COLORS[c])) ?? null;

/**
 * "Toggle highlight" (`color` null) and "Toggle red highlight" and the
 * rest, as Obsidian writes them (observed): the selection, or the word at
 * the caret, wrapped in ==, with the colour's emoji first. Inside a
 * highlight, the same command (or plain "Toggle highlight") removes it and
 * another colour recolours it.
 */
export const toggleHighlight =
  (color: HighlightColor | null): StateCommand =>
  ({ state, dispatch }) => {
    const emoji = color ? HIGHLIGHT_COLORS[color] : "";
    const changes = state.changeByRange((range) => {
      const line = state.doc.lineAt(range.from);
      // The line's ==highlights==, opening and closing marks paired in order.
      const marks = [...line.text.matchAll(/==/g)].map((m) => line.from + m.index);
      let around: [number, number] | null = null;
      for (let i = 0; i + 1 < marks.length; i += 2) if (marks[i] <= range.from && range.to <= marks[i + 1] + 2) around = [marks[i], marks[i + 1]];
      let specs: { from: number; to?: number; insert?: string }[];
      if (around) {
        const [open, close] = around;
        const current = highlightColor(state.sliceDoc(open + 2, open + 4));
        const had = current ? 2 : 0;
        specs =
          !color || current === color
            ? [{ from: open, to: open + 2 + had }, { from: close, to: close + 2 }]
            : [{ from: open + 2, to: open + 2 + had, insert: emoji }];
      } else {
        const word = range.empty ? state.wordAt(range.head) : null;
        if (range.empty && !word) return { changes: { from: range.from, insert: `==${emoji}==` }, range: EditorSelection.cursor(range.from + 2 + emoji.length) };
        const { from, to } = word ?? range;
        specs = [{ from, insert: "==" + emoji }, { from: to, insert: "==" }];
      }
      const set = state.changes(specs);
      // The selection keeps its text; a caret stays inside what it was in.
      const map = (pos: number, end: boolean) => set.mapPos(pos, end && pos !== range.from ? -1 : 1);
      return { changes: set, range: EditorSelection.range(map(range.anchor, range.anchor === range.to), map(range.head, range.head === range.to)) };
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

/** Home toggles between the text after a list/quote marker and column zero. */
export const markdownHome = (select = false): StateCommand => ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const ranges = state.selection.ranges.map((range) => {
    const line = state.doc.lineAt(range.head);
    const m = /^[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/.exec(line.text)!;
    if (!m[0].trim()) return null;
    for (let node = syntaxTree(state).resolveInner(line.from + m[0].length, 1); node.parent; node = node.parent) {
      if (node.name === "FencedCode" || node.name === "CodeBlock") return null;
    }
    const start = line.from + m[0].length;
    const head = range.head === start ? line.from : start;
    return select ? EditorSelection.range(range.anchor, head) : EditorSelection.cursor(head);
  });
  if (ranges.some((r) => r === null)) return false;
  dispatch(state.update({ selection: EditorSelection.create(ranges.filter((r) => r !== null), state.selection.mainIndex), scrollIntoView: true, userEvent: "select" }));
  return true;
};

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

/** Keep every selection endpoint attached to its text as line prefixes change. */
function updateLines(target: Target, specs: Parameters<EditorState["changes"]>[0]) {
  const { state } = target;
  const changes = state.changes(specs);
  const selection = EditorSelection.create(
    state.selection.ranges.map((r) => EditorSelection.range(changes.mapPos(r.anchor, 1), changes.mapPos(r.head, 1))),
    state.selection.mainIndex,
  );
  update(target, { changes, selection });
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
    updateLines({ state, dispatch }, specs);
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
  updateLines({ state, dispatch }, specs);
  return true;
};

/** Complete a newly typed fence; an existing closing fence is left to normal Enter handling. */
export const closeCodeFence: StateCommand = ({ state, dispatch }) => {
  const { main } = state.selection;
  if (state.readOnly || !main.empty || state.selection.ranges.length !== 1) return false;
  const line = state.doc.lineAt(main.head);
  const fence = /^([ \t]*)(`{3,}|~{3,})/.exec(line.text);
  if (!fence || main.head !== line.to) return false;
  let node = syntaxTree(state).resolveInner(line.from + fence[1].length, 1);
  while (node.parent && node.name !== "FencedCode") node = node.parent;
  if (node.name !== "FencedCode" || node.from !== line.from + fence[1].length || node.getChildren("CodeMark").length > 1) return false;
  const insert = state.lineBreak + fence[1] + state.lineBreak + fence[1] + fence[2];
  dispatch(state.update({ changes: { from: line.to, insert }, selection: { anchor: line.to + state.lineBreak.length + fence[1].length }, scrollIntoView: true, userEvent: "input" }));
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
