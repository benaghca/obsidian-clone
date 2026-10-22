import { history, redo, undo } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownSyntax } from "./syntax";
import { cellBelow, cellTransaction, editTable, formatTable, nextCell, parseTable, previousCell, type TableOp, tableAt, tableOps } from "./tables";

// The table and the results below are what Obsidian 1.14.4 wrote (observed).
const SOURCE = "| Name | Value | Note |\n| --- | :---: | ---: |\n| alpha | 1 | first |\n| beta longer | 22 | second |";
const PADDED = "| Name        | Value |   Note |\n| ----------- | :---: | -----: |\n| alpha       |   1   |  first |\n| beta longer |  22   | second |";
const table = parseTable(SOURCE);
const run = (op: TableOp, row: number, col: number) => {
  const done = op(table, { row, col });
  return done && formatTable(done.table);
};

describe("table rewrites", () => {
  it("pads every column to its widest cell, as aligned", () => {
    expect(formatTable(table)).toBe(PADDED);
    expect(formatTable(parseTable("|a|b\n|-|-\n|c"))).toBe("| a   | b   |\n| --- | --- |\n| c   |     |");
  });
  it("adds, moves, duplicates and deletes rows", () => {
    expect(run(tableOps.rowAbove, 2, 1)).toBe(
      "| Name        | Value |   Note |\n| ----------- | :---: | -----: |\n| alpha       |   1   |  first |\n|             |       |        |\n| beta longer |  22   | second |",
    );
    expect(run(tableOps.rowAbove, 0, 0)).toBe(
      "|             |       |        |\n| ----------- | :---: | -----: |\n| Name        | Value |   Note |\n| alpha       |   1   |  first |\n| beta longer |  22   | second |",
    );
    expect(run(tableOps.rowBelow, 2, 1)).toBe(`${PADDED}\n|             |       |        |`);
    expect(run(tableOps.moveRowUp, 1, 2)).toBe(
      "| alpha       |   1   |  first |\n| ----------- | :---: | -----: |\n| Name        | Value |   Note |\n| beta longer |  22   | second |",
    );
    expect(run(tableOps.moveRowUp, 0, 0)).toBeNull();
    expect(run(tableOps.moveRowDown, 2, 0)).toBeNull();
    expect(run(tableOps.duplicateRow, 1, 2)).toBe(
      "| Name        | Value |   Note |\n| ----------- | :---: | -----: |\n| alpha       |   1   |  first |\n| alpha       |   1   |  first |\n| beta longer |  22   | second |",
    );
    expect(run(tableOps.deleteRow, 0, 0)).toBe("| alpha       |   1   |  first |\n| ----------- | :---: | -----: |\n| beta longer |  22   | second |");
  });
  it("adds, moves, duplicates, aligns and deletes columns", () => {
    expect(run(tableOps.colLeft, 2, 1)).toBe(
      "| Name        |     | Value |   Note |\n| ----------- | :-: | :---: | -----: |\n| alpha       |     |   1   |  first |\n| beta longer |     |  22   | second |",
    );
    expect(run(tableOps.colRight, 1, 2)).toBe(
      "| Name        | Value |   Note |     |\n| ----------- | :---: | -----: | --: |\n| alpha       |   1   |  first |     |\n| beta longer |  22   | second |     |",
    );
    expect(run(tableOps.moveColLeft, 2, 1)).toBe(
      "| Value | Name        |   Note |\n| :---: | ----------- | -----: |\n|   1   | alpha       |  first |\n|  22   | beta longer | second |",
    );
    expect(run(tableOps.moveColLeft, 0, 0)).toBeNull();
    expect(run(tableOps.moveColRight, 1, 2)).toBeNull();
    expect(run(tableOps.duplicateCol, 2, 1)).toBe(
      "| Name        | Value | Value |   Note |\n| ----------- | :---: | :---: | -----: |\n| alpha       |   1   |   1   |  first |\n| beta longer |  22   |  22   | second |",
    );
    expect(run(tableOps.deleteCol, 1, 2)).toBe("| Name        | Value |\n| ----------- | :---: |\n| alpha       |   1   |\n| beta longer |  22   |");
    expect(run(tableOps.alignLeft, 2, 1)).toBe(
      "| Name        | Value |   Note |\n| ----------- | :---- | -----: |\n| alpha       | 1     |  first |\n| beta longer | 22    | second |",
    );
    expect(run(tableOps.alignCenter, 0, 0)).toBe(
      "|    Name     | Value |   Note |\n| :---------: | :---: | -----: |\n|    alpha    |   1   |  first |\n| beta longer |  22   | second |",
    );
    expect(run(tableOps.alignRight, 0, 0)).toBe(
      "|        Name | Value |   Note |\n| ----------: | :---: | -----: |\n|       alpha |   1   |  first |\n| beta longer |  22   | second |",
    );
  });
  it("steps through cells with Tab and Enter, adding a row after the last", () => {
    const to = (op: TableOp, row: number, col: number) => op(table, { row, col })?.to;
    expect([to(nextCell, 0, 2), to(nextCell, 1, 0), to(previousCell, 1, 0), to(previousCell, 0, 0), to(cellBelow, 0, 1)]).toEqual([
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 0, col: 2 },
      { row: 0, col: 0 },
      { row: 1, col: 1 },
    ]);
    // Tab in the last cell, Enter in the last row (as Obsidian writes them).
    expect(run(nextCell, 2, 2)).toBe(`${PADDED}\n|             |       |        |`);
    expect(to(nextCell, 2, 2)).toEqual({ row: 3, col: 0 });
    expect(run(cellBelow, 2, 1)).toBe(`${PADDED}\n|             |       |        |`);
    expect(to(cellBelow, 2, 1)).toEqual({ row: 3, col: 1 });
  });
  it("sorts the body by a column", () => {
    expect(run(tableOps.sortAsc, 1, 0)).toBe(PADDED);
    expect(run(tableOps.sortDesc, 1, 0)).toBe(
      "| Name        | Value |   Note |\n| ----------- | :---: | -----: |\n| beta longer |  22   | second |\n| alpha       |   1   |  first |",
    );
  });
});

describe("table editing in the editor", () => {
  // A stand-in for the view: editTable only reads its state and dispatches.
  const editor = (doc: string, at: number) => {
    let state = EditorState.create({ doc, extensions: markdownSyntax, selection: { anchor: at } });
    ensureSyntaxTree(state, doc.length, 1000);
    const view = {
      get state() {
        return state;
      },
      dispatch(spec: Parameters<EditorState["update"]>[0]) {
        state = state.update(spec).state;
      },
    } as unknown as EditorView;
    return view;
  };
  const doc = `Before\n\n${SOURCE}\n\nAfter`;
  const at = (text: string) => doc.indexOf(text) + 1;

  it("finds the cell under the caret", () => {
    const state = editor(doc, 0).state;
    ensureSyntaxTree(state, doc.length, 1000);
    expect(tableAt(state, at("alpha"))?.cell).toEqual({ row: 1, col: 0 });
    expect(tableAt(state, at("22"))?.cell).toEqual({ row: 2, col: 1 });
    expect(tableAt(state, at("Note"))?.cell).toEqual({ row: 0, col: 2 });
    expect(tableAt(state, at("After"))).toBeNull();
  });
  it("rewrites only the table's lines, in one change, caret in the target cell", () => {
    const view = editor(doc, at("22"));
    editTable(view, tableOps.rowBelow);
    expect(view.state.doc.toString()).toBe(`Before\n\n${PADDED}\n|             |       |        |\n\nAfter`);
    const sel = view.state.selection.main;
    expect(view.state.doc.lineAt(sel.head).number).toBe(7);
  });
  it("keeps Tab, Shift+Tab and Enter in their target cells after editing", () => {
    const view = editor(doc, at("alpha"));
    for (const [op, cell] of [
      [nextCell, { row: 1, col: 1 }],
      [cellBelow, { row: 2, col: 1 }],
      [cellBelow, { row: 3, col: 1 }],
      [previousCell, { row: 3, col: 0 }],
    ] as const) {
      editTable(view, op, true);
      expect(tableAt(view.state, view.state.selection.main.head)?.cell).toEqual(cell);
    }
  });
  it("puts the caret just inside an empty cell, so typing goes inside it (Tab in the last cell)", () => {
    const view = editor(doc, at("second"));
    editTable(view, nextCell, true);
    view.dispatch(view.state.replaceSelection("new"));
    expect(view.state.doc.line(7).text).toBe("| new            |       |        |");
  });
});

describe("in-place cell input", () => {
  it("escapes pipes without doubling existing escapes, and keeps pasted lines in the cell", () => {
    const input = (doc: string, text: string) => {
      const state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: EditorState.transactionFilter.of(cellTransaction) });
      return state.update(state.replaceSelection(text)).state.doc.toString();
    };
    expect(input("", "a|b\nnext")).toBe("a\\|b<br>next");
    expect(input("", "a\\|b")).toBe("a\\|b");
    expect(input("\\", "|")).toBe("\\|");
    expect(input("\\\\", "|")).toBe("\\\\\\|");
    const state = EditorState.create({ doc: "a\\|b", extensions: EditorState.transactionFilter.of(cellTransaction) });
    expect(state.update({ changes: { from: 1, to: 2 } }).state.doc.toString()).toBe("a\\|b");
  });
  it("maps the caret after an escaped pipe and undoes/redoes through the note's history", () => {
    let state = EditorState.create({ doc: "alpha", selection: { anchor: 5 }, extensions: EditorState.transactionFilter.of(cellTransaction) });
    const tr = state.update({ ...state.replaceSelection(" | next"), userEvent: "input.type" });
    state = tr.state;
    expect(state.doc.toString()).toBe("alpha \\| next");
    expect(state.selection.main.head).toBe(state.doc.length);
    let note = EditorState.create({ doc: SOURCE, extensions: [markdownSyntax, history()], selection: { anchor: SOURCE.indexOf("alpha") + 5 } });
    const at = note.selection.main.head - tr.startState.doc.length;
    const view = {
      get state() { return note; },
      dispatch(spec: Parameters<EditorState["update"]>[0]) { note = note.update(spec).state; },
    } as unknown as EditorView;
    const changes: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((f, t, _f, _t, text) => changes.push({ from: at + f, to: at + t, insert: text.toString() }));
    view.dispatch({ changes, selection: { anchor: at + tr.newSelection.main.head }, userEvent: "input.type" });
    expect(undo(view)).toBe(true);
    expect(note.doc.toString()).toBe(SOURCE);
    expect(tableAt(note, note.selection.main.head)?.cell).toEqual({ row: 1, col: 0 });
    expect(redo(view)).toBe(true);
    expect(note.sliceDoc(note.selection.main.head - 7, note.selection.main.head)).toBe("\\| next");
    expect(tableAt(note, note.selection.main.head)?.cell).toEqual({ row: 1, col: 0 });
  });
});
