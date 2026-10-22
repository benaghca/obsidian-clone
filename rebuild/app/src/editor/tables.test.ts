import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { markdownSyntax } from "./syntax";
import { cellBelow, editTable, formatTable, nextCell, parseTable, previousCell, type TableOp, tableAt, tableOps } from "./tables";

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
  it("puts the caret just inside an empty cell, so typing goes inside it (Tab in the last cell)", () => {
    const view = editor(doc, at("second"));
    editTable(view, nextCell, true);
    view.dispatch(view.state.replaceSelection("new"));
    expect(view.state.doc.line(7).text).toBe("| new            |       |        |");
  });
});
