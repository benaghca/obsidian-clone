import {expect,it} from "vitest";
import {writeView} from "./write";
import {baseModel} from "./model";
import {reordered} from "./drag";
import {columnWidth} from "./columns";
const source='# before\nfilters: \'status != "done"\'\nviews:\n  - type: table\n    name: "Quoted"\n    order: [file.name, due, status]\n    # after order\n  - type: table\n    name: Other\n# tail\n';
it("inserts, updates and removes only columnSize, preserving other views, quotes, comments and CRLF",()=>{
 const block='    columnSize:\n      note.due: 196\n      note.status: 40\n';
 const sized=writeView(source,'columnSize',{'note.due':196,'note.status':40});
 expect(sized).toBe(source.replace('    # after order',block+'    # after order'));
 expect(writeView(sized,'columnSize',{'note.status':40})).toBe(sized.replace('      note.due: 196\n',''));
 expect(writeView(sized,'columnSize',undefined)).toBe(source);
 expect(writeView(source,'columnSize',undefined)).toBe(source);
 expect(writeView(source,'columnSize',{'file.name':100},1)).toBe(source.replace('# tail','    columnSize:\n      file.name: 100\n# tail'));
 expect(writeView(source.replaceAll('\n','\r\n'),'columnSize',{'note.due':196,'note.status':40})).toBe(sized.replaceAll('\n','\r\n'));
 expect(baseModel(writeView(source,'columnSize',{'note.a: b':99.5})).sizes).toEqual({'note.a: b':99.5});
 expect(baseModel(sized).sizes).toEqual({'note.due':196,'note.status':40});
});
it("reorders a key before or after the target and rewrites only the order/sort block",()=>{
 expect(reordered(['name','due','status'],2,1)).toEqual(['name','status','due']);
 expect(reordered(['name','due','status'],0,3)).toEqual(['due','status','name']);
 expect(reordered(['name','due','status'],1,2)).toEqual(['name','due','status']);
 expect(writeView(source,'order',['status','file.name','due'])).toBe(source.replace('    order: [file.name, due, status]\n','    order:\n      - status\n      - file.name\n      - due\n'));
 const sorts=[{property:'due',direction:'ASC' as const},{property:'file.name',direction:'DESC' as const}];
 const sorted=writeView(source,'sort',sorts);
 expect(writeView(sorted,'sort',reordered(sorts,0,2))).toBe(sorted.replace('      - property: due\n        direction: ASC\n      - property: file.name\n        direction: DESC\n','      - property: file.name\n        direction: DESC\n      - property: due\n        direction: ASC\n'));
});

const px = (text: string) => text.length * 10;
const header = (label: string, extra: Partial<Parameters<typeof columnWidth>[1]> = {}) =>
  columnWidth(px, { key: "t", label, sorted: false, type: "text", ...extra });

it("fits a column to the widest cell, and leaves the header width unchanged when text is omitted", () => {
  const short = "t";
  const long = "this cell is much longer than the header";
  const alone = header(short);
  expect(alone).toBe(60);
  expect(header("status")).toBe(94);
  expect(header("status", { sorted: true })).toBe(110);
  expect(columnWidth(px, { key: "file.name", label: "x", sorted: false, type: "text" })).toBe(78);
  const fitted = columnWidth(px, { key: "t", label: short, sorted: false, type: "text", text: ["no", long] });
  expect(fitted).toBe(long.length * 10 + 16);
  expect(fitted).toBeGreaterThan(alone);
  expect(columnWidth(px, { key: "t", label: short, sorted: false, type: "text", text: ["no"] })).toBe(alone);
});

it("keeps date, checkbox and pill widths, and skips cells that cannot be the widest", () => {
  const date = { key: "due", label: "Due date", sorted: true, type: "date" as const };
  expect(columnWidth(px, date)).toBe(128);
  expect(columnWidth(px, { ...date, text: ["not used because a date column has a fixed width"] })).toBe(128);
  expect(columnWidth(px, { key: "when", label: "When", sorted: false, type: "datetime" })).toBe(210);
  const check = { key: "done", label: "done", sorted: false, type: "checkbox" as const };
  expect(columnWidth(px, { ...check, text: ["true"] })).toBe(columnWidth(px, check));
  expect(columnWidth(px, { key: "tags", label: "tags", sorted: false, type: "tags", pills: [["abcd"]] })).toBe(100);
  const seen: string[] = [];
  const width = columnWidth((text) => { seen.push(text); return text.length * 10; }, {
    key: "t", label: "t", sorted: false, type: "text",
    text: ["tiny", "this cell is much longer than the header"],
  });
  expect(width).toBeGreaterThan(60);
  expect(seen).not.toContain("tiny");
});

it("measures each rendered kind once, and a list drawn in a text column widens the fit", () => {
  const long = "this cell is much longer than the header";
  const seen: string[] = [];
  const samples = [
    { kind: "text", text: "tiny" },
    ...Array.from({ length: 40 }, () => ({ kind: "text", text: long })),
    { kind: "list", pills: ["abcd"] },
    { kind: "list", pills: ["abcd"] },
    { kind: "checkbox" },
    { kind: "date" },
  ];
  const width = columnWidth((text) => { seen.push(text); return text.length * 10; }, {
    key: "t", label: "t", sorted: false, type: "text", samples,
  });
  expect(width).toBe(long.length * 10 + 16);
  expect(seen.filter(text => text === long)).toEqual([long]);
  expect(seen).not.toContain("tiny");
  expect(seen.filter(text => text === "abcd")).toEqual(["abcd"]);
  const date = { key: "due", label: "Due date", sorted: true, type: "date" as const };
  expect(columnWidth(px, { ...date, samples: [{ kind: "date" }] })).toBe(128);
  expect(columnWidth(px, { ...date, samples: [{ kind: "list", pills: ["abcdefghij"] }] })).toBe(160);
});
