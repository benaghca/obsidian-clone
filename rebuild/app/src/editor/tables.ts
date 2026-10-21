// GitHub-style pipe tables (the parser's GFM Table node) drawn as tables:
// the header row bold, each column aligned as its ":---:" says, cells
// rendered as Reading view renders inline markdown, a wide table scrolling
// sideways inside the readable column. Obsidian edits the cells in place;
// here a click on a cell puts the caret in that cell's source instead,
// which shows the table as markdown while the caret is in it (blocks.ts).

import { type EditorView, WidgetType } from "@codemirror/view";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { editAt } from "./callouts";
import { isLinkEvent } from "./embeds";
import { readingMode } from "./livePreview";
import { decorate, destroyed, onDestroy, type Painted, paintRange, release } from "./render";

export type Align = "left" | "center" | "right" | "";

/**
 * A row's cells, as offsets into the line, trimmed: split at pipes that
 * aren't escaped; the pipes at either end are optional, as in GFM.
 */
export function splitRow(line: string): { from: number; to: number }[] {
  const bars: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "|") bars.push(i);
  }
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

export class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly chain: readonly string[],
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.text === this.text && o.chain.join("\0") === this.chain.join("\0");
  }
  toDOM(view: EditorView) {
    const lines = this.text.split("\n");
    const align = alignments(lines[1] ?? "");
    const columns = splitRow(lines[0]).length;
    const painted: Painted = decorate(this.text, view, this.chain);
    const table = h("table");
    let at = 0;
    lines.forEach((line, n) => {
      const start = at;
      at += line.length + 1;
      if (n === 1) return;
      const cells = splitRow(line).slice(0, columns);
      const tr = h("tr");
      for (let c = 0; c < columns; c++) {
        const cell = cells[c] ?? { from: line.length, to: line.length };
        const td = h(n === 0 ? "th" : "td", { "data-offset": String(start + cell.from) });
        if (align[c]) td.style.textAlign = align[c];
        paintRange(painted, td, start + cell.from, start + cell.to);
        tr.append(td);
      }
      if (n === 0) table.append(h("thead", null, tr));
      else (table.tBodies[0] ?? table.appendChild(h("tbody"))).append(tr);
    });
    const edit = h("div", { class: "embed-action edit-block-button", "aria-label": "Edit this block", title: "Edit this block" }, icon("code-xml"));
    const dom = h("div", { class: "cm-table-widget" }, h("div", { class: "table-wrapper" }, table), h("div", { class: "embed-actions" }, edit));
    dom.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || isLinkEvent(e) || view.state.facet(readingMode)) return;
      const cell = (e.target as Element).closest<HTMLElement>("[data-offset]");
      e.preventDefault();
      editAt(view, view.posAtDOM(dom) + Number(cell?.dataset.offset ?? 0));
    });
    onDestroy(dom, () => release(painted));
    return dom;
  }
  destroy(dom: HTMLElement) {
    destroyed(dom);
  }
  ignoreEvent(e: Event) {
    return !isLinkEvent(e);
  }
}
