// Editing a table's markdown as Obsidian 1.14.4's table editor does
// (observed): Tab and Shift+Tab step to the next and previous cell (Tab in
// the last one adds a row), Enter goes to the cell below (in the last row
// it adds one), Shift+Enter writes <br>, and the table menu's rows and
// columns: add, move, duplicate, delete, align and sort. Every edit writes
// the whole table back padded as Obsidian pads it (each column as wide as
// its widest cell, at least 3, and never narrower than it was: deleting a
// long row leaves its column's width), in one transaction: one undo step,
// touching only the table's lines.

import { completionStatus } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, Prec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { type Align, alignments, splitRow } from "./tables";

export interface Column {
  align: Align;
  /** How wide it was written (it pads to at least this). */
  width: number;
}

export interface Table {
  /** The header first; the delimiter row is `cols`. */
  rows: string[][];
  cols: Column[];
}

export function parseTable(text: string): Table {
  const lines = text.split("\n");
  const cells = (line: string) => splitRow(line).map(({ from, to }) => line.slice(from, to));
  const rows = lines.filter((_, i) => i !== 1).map(cells);
  const align = alignments(lines[1] ?? "");
  const columns = Math.max(align.length, ...rows.map((r) => r.length));
  const full = rows.map((r) => Array.from({ length: columns }, (_, c) => r[c] ?? ""));
  return { rows: full, cols: Array.from({ length: columns }, (_, c) => ({ align: align[c] ?? "", width: Math.max(...full.map((r) => r[c].length)) })) };
}

const DELIMITER: Record<Align, (w: number) => string> = {
  "": (w) => "-".repeat(w),
  left: (w) => ":" + "-".repeat(w - 1),
  center: (w) => ":" + "-".repeat(w - 2) + ":",
  right: (w) => "-".repeat(w - 1) + ":",
};

function pad(text: string, width: number, align: Align) {
  const space = width - text.length;
  if (align === "right") return " ".repeat(space) + text;
  if (align === "center") return " ".repeat(space >> 1) + text + " ".repeat(space - (space >> 1));
  return text + " ".repeat(space);
}

export function formatTable({ rows, cols }: Table): string {
  const widths = cols.map((col, c) => Math.max(3, col.width, ...rows.map((r) => r[c].length)));
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const out = rows.map((r) => line(r.map((cell, c) => pad(cell, widths[c], cols[c].align))));
  out.splice(1, 0, line(cols.map((col, c) => DELIMITER[col.align](widths[c]))));
  return out.join("\n");
}

/** A cell, by row (0 is the header) and column. */
export interface Cell {
  row: number;
  col: number;
}

/** A table edit: the new table, and the cell the caret goes to. */
export type TableOp = (t: Table, at: Cell) => { table: Table; to: Cell } | null;

const moved = <T>(list: T[], from: number, to: number) => {
  const out = [...list];
  out.splice(to, 0, ...out.splice(from, 1));
  return out;
};
const withRows = (t: Table, rows: string[][]) => ({ ...t, rows });
const emptyRow = (t: Table) => t.cols.map(() => "");
/** The same change to every row's cells and to the columns. */
const columns = (t: Table, fn: <T>(list: T[], fresh: T) => T[], fresh = ""): Table => ({
  rows: t.rows.map((r) => fn(r, fresh)),
  cols: fn<Column>(t.cols, { align: "", width: 0 }),
});
const align = (t: Table, col: number, a: Align) => ({ ...t, cols: t.cols.with(col, { ...t.cols[col], align: a }) });

export const tableOps = {
  rowAbove: (t, { row, col }) => ({ table: withRows(t, t.rows.toSpliced(row, 0, emptyRow(t))), to: { row, col } }),
  rowBelow: (t, { row, col }) => ({ table: withRows(t, t.rows.toSpliced(row + 1, 0, emptyRow(t))), to: { row: row + 1, col } }),
  moveRowUp: (t, { row, col }) => (row > 0 ? { table: withRows(t, moved(t.rows, row, row - 1)), to: { row: row - 1, col } } : null),
  moveRowDown: (t, { row, col }) => (row < t.rows.length - 1 ? { table: withRows(t, moved(t.rows, row, row + 1)), to: { row: row + 1, col } } : null),
  duplicateRow: (t, { row, col }) => ({ table: withRows(t, t.rows.toSpliced(row + 1, 0, [...t.rows[row]])), to: { row: row + 1, col } }),
  deleteRow: (t, { row, col }) => (t.rows.length > 1 ? { table: withRows(t, t.rows.toSpliced(row, 1)), to: { row: Math.max(0, row - 1), col } } : null),
  // A new column takes the alignment of the one it was added next to.
  colLeft: (t, { row, col }) => ({ table: align(columns(t, (l, fresh) => l.toSpliced(col, 0, fresh)), col, t.cols[col].align), to: { row, col } }),
  colRight: (t, { row, col }) => ({ table: align(columns(t, (l, fresh) => l.toSpliced(col + 1, 0, fresh)), col + 1, t.cols[col].align), to: { row, col: col + 1 } }),
  moveColLeft: (t, { row, col }) => (col > 0 ? { table: columns(t, (l) => moved(l, col, col - 1)), to: { row, col: col - 1 } } : null),
  moveColRight: (t, { row, col }) => (col < t.cols.length - 1 ? { table: columns(t, (l) => moved(l, col, col + 1)), to: { row, col: col + 1 } } : null),
  duplicateCol: (t, { row, col }) => ({ table: columns(t, (l) => l.toSpliced(col + 1, 0, l[col])), to: { row, col: col + 1 } }),
  deleteCol: (t, { row, col }) => (t.cols.length > 1 ? { table: columns(t, (l) => l.toSpliced(col, 1)), to: { row, col: Math.max(0, col - 1) } } : null),
  alignLeft: (t, at) => ({ table: align(t, at.col, "left"), to: at }),
  alignCenter: (t, at) => ({ table: align(t, at.col, "center"), to: at }),
  alignRight: (t, at) => ({ table: align(t, at.col, "right"), to: at }),
  sortAsc: (t, at) => ({ table: withRows(t, [t.rows[0], ...t.rows.slice(1).sort((a, b) => a[at.col].localeCompare(b[at.col]))]), to: at }),
  sortDesc: (t, at) => ({ table: withRows(t, [t.rows[0], ...t.rows.slice(1).sort((a, b) => b[at.col].localeCompare(a[at.col]))]), to: at }),
} satisfies Record<string, TableOp>;

/** The table around `pos` (its lines' extent) and the cell `pos` is in; null outside a table. */
export function tableAt(state: EditorState, pos: number): { from: number; to: number; cell: Cell } | null {
  const table = (side: -1 | 1) => {
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
    while (node && node.name !== "Table") node = node.parent;
    return node;
  };
  const node = table(-1) ?? table(1);
  if (!node) return null;
  const from = state.doc.lineAt(node.from).from;
  const to = state.doc.lineAt(node.to).to;
  const line = state.doc.lineAt(pos);
  const n = line.number - state.doc.lineAt(from).number;
  // The column: the pipes before the caret, not counting a leading one.
  let bars = 0;
  for (let i = 0; i < pos - line.from; i++) {
    if (line.text[i] === "\\") i++;
    else if (line.text[i] === "|") bars++;
  }
  const col = bars - (line.text.trimStart().startsWith("|") ? 1 : 0);
  return { from, to, cell: { row: n < 2 ? 0 : n - 1, col: Math.max(0, col) } };
}

/** The table at `pos`, read, with the cell `pos` is in. */
export function tableModel(state: EditorState, pos: number) {
  const found = tableAt(state, pos);
  if (!found) return null;
  const table = parseTable(state.sliceDoc(found.from, found.to));
  const cell = { row: Math.min(found.cell.row, table.rows.length - 1), col: Math.min(found.cell.col, table.cols.length - 1) };
  return { ...found, table, cell };
}

/** Rewrite the table at the caret with `op`; the caret goes to its cell (its text selected, `select`). */
export function editTable(view: EditorView, op: TableOp, select = false, at = view.state.selection.main.head): boolean {
  const { state } = view;
  const found = tableModel(state, at);
  if (!found || state.readOnly) return false;
  const done = op(found.table, found.cell);
  if (!done) return true;
  const text = formatTable(done.table);
  // Where the target cell's text is in the new lines.
  const lines = text.split("\n");
  const n = done.to.row === 0 ? 0 : done.to.row + 1;
  const start = found.from + lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0);
  const target = splitRow(lines[n])[done.to.col] ?? { from: 2, to: 2 };
  const end = start + target.from + done.table.rows[done.to.row][done.to.col].length;
  const anchor = select ? start + target.from : end;
  // Moving within a table already padded changes nothing (no empty undo step).
  view.dispatch({
    changes: text === state.sliceDoc(found.from, found.to) ? [] : { from: found.from, to: found.to, insert: text },
    selection: EditorSelection.single(anchor, end),
    scrollIntoView: true,
    userEvent: "input.table",
  });
  return true;
}

const go = (t: Table, row: number, col: number) => ({ table: t, to: { row, col } });

/** Tab: the next cell, or a new row after the last one. */
export const nextCell: TableOp = (t, { row, col }) => {
  if (col + 1 < t.cols.length) return go(t, row, col + 1);
  if (row + 1 < t.rows.length) return go(t, row + 1, 0);
  return { table: withRows(t, [...t.rows, emptyRow(t)]), to: { row: row + 1, col: 0 } };
};
export const previousCell: TableOp = (t, { row, col }) => (col > 0 ? go(t, row, col - 1) : row > 0 ? go(t, row - 1, t.cols.length - 1) : go(t, row, col));
/** Enter: the cell below, or a new row under the last one. */
export const cellBelow: TableOp = (t, at) => (at.row + 1 < t.rows.length ? go(t, at.row + 1, at.col) : tableOps.rowBelow(t, at));

const inTable = (fn: (view: EditorView) => boolean) => (view: EditorView) =>
  completionStatus(view.state) !== "active" && view.state.selection.ranges.length === 1 && !!tableAt(view.state, view.state.selection.main.head) && fn(view);

/** The keys, ahead of list continuation and indenting, while the caret is in a table. */
export const tableKeys = Prec.highest(
  keymap.of([
    { key: "Tab", run: inTable((v) => editTable(v, nextCell, true)) },
    { key: "Shift-Tab", run: inTable((v) => editTable(v, previousCell, true)) },
    { key: "Enter", run: inTable((v) => editTable(v, cellBelow, true)) },
    { key: "Shift-Enter", run: inTable((v) => (v.dispatch({ ...v.state.replaceSelection("<br>"), userEvent: "input" }), true)) },
  ]),
);
