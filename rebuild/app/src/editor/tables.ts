// GFM tables stay drawn in Live Preview. Only the active cell has a nested
// editor; its changes and selection go to the note's existing undo history.
// Row/column actions still use the same padded table formatter below.

import { completionStatus } from "@codemirror/autocomplete";
import { defaultKeymap, isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { ChangeSet, EditorSelection, EditorState, Prec, StateEffect, StateField, Transaction } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { h } from "../shell/dom";
import { pairingExtensions } from "./config";
import { editorHost } from "./host";
import { BlockWidget, decorate, editAt, editButton, isLinkEvent, onDestroy, type Painted, paintRange, readingMode, release } from "./render";

export type Align = "left" | "center" | "right" | "";

/** Where a row's pipes are, up to `end` (escaped ones aren't). */
function pipes(line: string, end = line.length): number[] {
  const at: number[] = [];
  for (let i = 0; i < end; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "|") at.push(i);
  }
  return at;
}

/**
 * A row's cells, as offsets into the line, trimmed: split at pipes that
 * aren't escaped; the pipes at either end are optional, as in GFM.
 */
export function splitRow(line: string): { from: number; to: number }[] {
  const bars = pipes(line);
  const bounds = [-1, ...bars, line.length];
  const cells: { from: number; to: number }[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    let from = bounds[k] + 1;
    let to = bounds[k + 1];
    const outer = (k === 0 || k === bounds.length - 2) && !line.slice(from, to).trim();
    if (outer && bars.length) continue;
    while (from < to && /\s/.test(line[from])) from++;
    while (to > from && /\s/.test(line[to - 1])) to--;
    cells.push({ from, to });
  }
  return cells;
}

/** Each column's alignment, from the delimiter row ("| :--- | :-: | --: |"). */
export function alignments(row: string): Align[] {
  return splitRow(row).map(({ from, to }) => {
    const cell = row.slice(from, to);
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : "";
  });
}

/** Explicit source editing lasts while the caret stays in this table. */
export const editTableSource = StateEffect.define<number | null>();
export const tableSource = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    if (value !== null) value = tr.changes.mapPos(value, -1);
    for (const e of tr.effects) if (e.is(editTableSource)) value = e.value;
    return value !== null && tableAt(tr.state, tr.state.selection.main.head)?.from === value ? value : null;
  },
});

const tableDOM = new WeakMap<HTMLElement, (widget: TableWidget) => void>();
const tableSync = new WeakMap<EditorView, Set<(u?: ViewUpdate) => void>>();

export class TableWidget extends BlockWidget {
  updateDOM(dom: HTMLElement) {
    tableDOM.get(dom)?.(this);
    return true;
  }
  toDOM(view: EditorView) {
    const table = h("table");
    const dom = h("div", { class: "cm-table-widget" }, table, editButton());
    let widget: TableWidget = this;
    let painted: Painted | null = null;
    let inner: EditorView | null = null;
    let active: HTMLTableCellElement | null = null;
    let range: { from: number; to: number } | null = null;
    let syncing = false;
    let dirty = true;
    let dismissedAt: number | null = null;
    let pending = false;
    let held: AbortController | null = null;
    const start = () => view.posAtDOM(dom);
    const cellPos = (td: HTMLElement) => {
      const row = (td.parentElement as HTMLTableRowElement).rowIndex;
      const n = row === 0 ? 0 : row + 1;
      const lines = widget.text.split("\n");
      const line = lines[n];
      const cell = splitRow(line)[(td as HTMLTableCellElement).cellIndex];
      const offset = cell && cell.from !== cell.to ? cell.from : Math.min(cell?.from ?? line.length, line.lastIndexOf("|", (cell?.from ?? line.length) - 1) + 2);
      return start() + lines.slice(0, n).reduce((sum, l) => sum + l.length + 1, 0) + offset;
    };
    const leave = (dir: number) => {
      const from = start();
      const anchor = dir < 0 ? Math.max(0, from - 1) : Math.min(view.state.doc.length, from + widget.text.length + 1);
      view.dispatch({ selection: { anchor } });
      dismissedAt = anchor;
      view.focus();
      sync();
      return true;
    };
    const sync = () => {
      if (!dom.isConnected) return;
      const { state } = view;
      const sel = state.selection.main;
      if (!dirty && range && inner?.hasFocus && sel.head !== dismissedAt && sel.anchor === range.from + inner.state.selection.main.anchor && sel.head === range.from + inner.state.selection.main.head && state.sliceDoc(range.from, range.to) === inner.state.doc.toString()) return;
      const from = start();
      const found = tableAt(state, sel.head);
      const direct = state.sliceDoc(from, from + widget.text.length) === widget.text;
      const editing = direct && state.field(tableSource, false) !== from && sel.head !== dismissedAt && !state.readOnly && !state.facet(readingMode) && (view.hasFocus || inner?.hasFocus);
      const row = editing && found?.from === from && sel.from >= from && sel.to <= from + widget.text.length ? found.cell.row : -1;
      const col = found?.cell.col ?? -1;
      const target = table.rows[row]?.cells[col] ?? null;
      if (active !== target) {
        inner?.destroy();
        inner = null;
        active = target;
        range = null;
        dirty = true;
      }
      if (dirty) {
        if (painted) release(painted);
        painted = decorate(widget.text, view, widget.chain, (line) => widget.tick(view, dom, line));
        const lines = widget.text.split("\n");
        const align = alignments(lines[1] ?? "");
        const columns = splitRow(lines[0]).length;
        const rows = lines.filter((_, n) => n !== 1);
        while (table.rows.length > rows.length) table.deleteRow(-1);
        let offset = 0;
        rows.forEach((line, r) => {
          if (r === 1) offset += lines[1].length + 1;
          const tr = table.rows[r] ?? (r === 0 ? table.createTHead() : table.tBodies[0] ?? table.createTBody()).insertRow();
          while (tr.cells.length > columns) tr.deleteCell(-1);
          const cells = splitRow(line);
          for (let c = 0; c < columns; c++) {
            const cell = cells[c] ?? { from: line.length, to: line.length };
            const td = tr.cells[c] ?? tr.appendChild(h(r === 0 ? "th" : "td"));
            const cellFrom = cell.from === cell.to ? Math.min(cell.from, line.lastIndexOf("|", cell.from - 1) + 2) : cell.from;
            td.dataset.offset = String(offset + cellFrom);
            td.dataset.end = String(offset + (cell.from === cell.to ? cellFrom : cell.to));
            td.style.textAlign = align[c];
            if (td !== active || !inner) {
              td.replaceChildren();
              paintRange(painted!, td, offset + cell.from, offset + cell.to);
            }
          }
          offset += line.length + 1;
        });
        dirty = false;
      }
      // A newly drawn table may already contain the note's caret (undo or arrow entry).
      active = row >= 0 ? table.rows[row]?.cells[col] ?? null : null;
      if (!active) return;
      range ??= { from: cellPos(active), to: from + Number(active.dataset.end) };
      const at = range.from;
      const text = state.sliceDoc(at, range.to);
      const clamp = (p: number) => Math.max(0, Math.min(text.length, p - at));
      const selection = EditorSelection.single(clamp(sel.anchor), clamp(sel.head));
      syncing = true;
      if (!inner) {
        active.style.minWidth = `${active.getBoundingClientRect().width - 17}px`;
        active.replaceChildren();
        inner = new EditorView({
          parent: active,
          state: EditorState.create({ doc: text, selection, extensions: [
            EditorView.editorAttributes.of({ class: "cm-table-cell" }),
            EditorView.lineWrapping,
            EditorState.transactionFilter.of((tr) => {
              if (!tr.docChanged || syncing) return tr;
              return cellTransaction(tr);
            }),
            EditorView.domEventHandlers({ blur() { queueMicrotask(sync); }, keydown(e, cellView) {
              e.stopPropagation();
              if (e.key === "Escape") return leave(1);
              if ((e.ctrlKey || e.metaKey) && /^(z|y)$/i.test(e.key) && runScopeHandlers(view, e, "editor")) return true;
              const go = (op: TableOp) => { editTable(view, op, true); sync(); return true; };
              if (e.key === "Tab") return go(e.shiftKey ? previousCell : nextCell);
              if (e.key === "Enter") {
                if (e.shiftKey) { cellView.dispatch(cellView.state.replaceSelection("<br>")); return true; }
                return go(cellBelow);
              }
              const s = cellView.state.selection.main;
              if (!s.empty || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
              const left = e.key === "ArrowLeft" && s.head === 0;
              const right = e.key === "ArrowRight" && s.head === cellView.state.doc.length;
              const up = e.key === "ArrowUp" && cellView.coordsAtPos(s.head)?.top === cellView.coordsAtPos(0)?.top;
              const down = e.key === "ArrowDown" && cellView.coordsAtPos(s.head)?.top === cellView.coordsAtPos(cellView.state.doc.length)?.top;
              if (!left && !right && !up && !down) return false;
              const model = tableModel(view.state, range!.from)!;
              const { row, col } = model.cell;
              if ((left || up) && row === 0 && (up || col === 0)) return leave(-1);
              if ((right || down) && row === model.table.rows.length - 1 && (down || col === model.table.cols.length - 1)) return leave(1);
              go(left ? previousCell : right ? nextCell : (t) => ({ table: t, to: { row: row + (up ? -1 : 1), col } }));
              const dest = view.state.selection.main;
              view.dispatch({ selection: { anchor: left || up ? dest.to : dest.from } });
              sync();
              return true;
            } }),
            pairingExtensions(),
            keymap.of(defaultKeymap),
          ] }),
          dispatchTransactions(trs, cellView) {
            cellView.update(trs);
            if (syncing) return;
            for (const tr of trs) {
              const at = range!.from;
              const changes: { from: number; to: number; insert: string }[] = [];
              tr.changes.iterChanges((f, t, _f, _t, insert) => changes.push({ from: at + f, to: at + t, insert: insert.toString() }));
              const s = tr.state.selection.main;
              view.dispatch({ changes, selection: EditorSelection.single(at + s.anchor, at + s.head), userEvent: tr.annotation(Transaction.userEvent) ?? (tr.docChanged ? "input.type" : "select"), annotations: tr.docChanged ? undefined : isolateHistory.of("after") });
            }
          },
        });
      } else if (inner.state.doc.toString() !== text || !inner.state.selection.eq(selection)) {
        inner.dispatch({ changes: inner.state.doc.toString() === text ? [] : { from: 0, to: inner.state.doc.length, insert: text }, selection });
      }
      syncing = false;
      if (editing) inner.focus();
    };
    const schedule = (u?: ViewUpdate) => {
      if (u?.transactions.some((tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"))) dismissedAt = null;
      if (range && u?.docChanged) {
        const old = range;
        let within = true;
        u.changes.iterChangedRanges((f, t) => { if (f < old.from || t > old.to) within = false; });
        // Ordinary typing changes only the nested editor, keeping every other cell DOM intact.
        if (within && inner) dirty = false;
        range = within ? { from: u.changes.mapPos(old.from, -1), to: u.changes.mapPos(old.to, 1) } : null;
      }
      if (!pending) {
        pending = true;
        queueMicrotask(() => { pending = false; sync(); });
      }
    };
    const listeners = tableSync.get(view) ?? new Set<(u?: ViewUpdate) => void>();
    tableSync.set(view, listeners);
    listeners.add(schedule);
    tableDOM.set(dom, (next) => { widget = next; dirty = true; schedule(); });
    dom.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || isLinkEvent(e) || view.state.readOnly || view.state.facet(readingMode)) return;
      if (inner?.dom.contains(e.target as Node)) { e.stopPropagation(); return; }
      e.preventDefault();
      e.stopPropagation();
      if ((e.target as Element).closest(".embed-actions")) {
        const anchor = start();
        view.dispatch({ selection: { anchor }, effects: editTableSource.of(anchor), scrollIntoView: true });
        view.focus();
        return;
      }
      if (view.state.field(tableSource, false) != null) view.dispatch({ effects: editTableSource.of(null) });
      const td = (e.target as Element).closest<HTMLTableCellElement>("td, th") ?? table.rows[0].cells[0];
      dismissedAt = null;
      if (view.state.sliceDoc(start(), start() + widget.text.length) !== widget.text) { editAt(view, start()); return; }
      const row = (td.parentElement as HTMLTableRowElement).rowIndex;
      const col = td.cellIndex;
      if (!splitRow(widget.text.split("\n")[row === 0 ? 0 : row + 1])[col]) {
        editTable(view, (table) => ({ table, to: { row, col } }), true, start());
        view.focus();
      } else editAt(view, cellPos(td));
      sync();
      inner!.focus();
      const anchor = inner!.posAtCoords({ x: e.clientX, y: e.clientY }) ?? 0;
      inner!.dispatch({ selection: { anchor } });
      held?.abort();
      held = new AbortController();
      window.addEventListener("mousemove", (move) => {
        if (!inner) return;
        const head = inner.posAtCoords({ x: move.clientX, y: move.clientY }, false) ?? anchor;
        inner.dispatch({ selection: { anchor, head } });
      }, { signal: held.signal });
      window.addEventListener("mouseup", () => held?.abort(), { signal: held.signal, once: true });
    });
    dom.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const td = (e.target as Element).closest<HTMLElement>("[data-offset]");
      const pos = td ? cellPos(td) : start();
      if (!view.state.facet(readingMode)) { dismissedAt = null; editAt(view, pos); }
      view.state.facet(editorHost)?.contextMenu?.(view, { x: e.clientX, y: e.clientY }, pos, false);
    });
    const outside = (e: MouseEvent) => {
      if (inner && !dom.contains(e.target as Node) && !(e.target as Element).closest(".menu")) {
        queueMicrotask(() => { dismissedAt = view.state.selection.main.head; sync(); });
      }
    };
    window.addEventListener("mousedown", outside, true);
    onDestroy(dom, () => {
      window.removeEventListener("mousedown", outside, true);
      listeners.delete(schedule);
      held?.abort();
      inner?.destroy();
      if (painted) release(painted);
    });
    // posAtDOM is available after CodeMirror has attached the widget.
    schedule();
    return dom;
  }
}

/** Escape delimiter pipes (also after deleting their escape) and keep pasted lines in one cell. */
export function cellTransaction(tr: Transaction) {
  const corrections: { from: number; to: number; insert: string }[] = [];
  const text = tr.newDoc.toString();
  let slashes = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "|" && slashes % 2 === 0) corrections.push({ from: i, to: i, insert: "\\" });
    if (text[i] === "\n") corrections.push({ from: i, to: i + 1, insert: "<br>" });
    slashes = text[i] === "\\" ? slashes + 1 : 0;
  }
  const escaped = ChangeSet.of(corrections, tr.newDoc.length);
  return { changes: tr.changes.compose(escaped), selection: tr.newSelection.map(escaped), effects: StateEffect.mapEffects(tr.effects, escaped), userEvent: tr.annotation(Transaction.userEvent) };
}

// ----- editing -----

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
const columns = (t: Table, fn: <T>(list: T[], fresh: T) => T[]): Table => ({
  rows: t.rows.map((r) => fn(r, "")),
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
  const col = pipes(line.text, pos - line.from).length - (line.text.trimStart().startsWith("|") ? 1 : 0);
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
  const cell = done.table.rows[done.to.row][done.to.col];
  // An empty cell's caret goes just inside its left edge ("| "), so typing fills the padded cell, as in Obsidian.
  const from = start + (cell ? splitRow(lines[n])[done.to.col].from : pipes(lines[n])[done.to.col] + 2);
  const end = from + cell.length;
  const anchor = select ? from : end;
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
export const tableKeys = [
  tableSource,
  EditorView.updateListener.of((u) => { if (u.docChanged || u.selectionSet || u.focusChanged) tableSync.get(u.view)?.forEach((sync) => sync(u)); }),
  Prec.highest(keymap.of([
    { key: "Tab", run: inTable((v) => editTable(v, nextCell, true)) },
    { key: "Shift-Tab", run: inTable((v) => editTable(v, previousCell, true)) },
    { key: "Enter", run: inTable((v) => editTable(v, cellBelow, true)) },
    { key: "Shift-Enter", run: inTable((v) => (v.dispatch({ ...v.state.replaceSelection("<br>"), userEvent: "input" }), true)) },
  ])),
];
