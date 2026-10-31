// Edge cases the other Bases tests do not pin down: formula failures through a
// base model, values stored as the wrong type, grouping of empties and case,
// and summaries/CSV of the rows a search keeps. Behavior follows the rules
// already decided for Grove (display names are per base, ".md" is not a note,
// summaries and CSV follow the search). No Obsidian source was used.
import { expect, it } from "vitest";
import type { FileEntry } from "../api";
import type { Property } from "../editor/frontmatter";
import { isFormulaError, type Value } from "./expression";
import { groupRows } from "./groups";
import { baseModel, baseNoteFiles, type Row } from "./model";
import { tableCsv } from "./results";
import { rowText, searchWork } from "./search";
import { summarize, summaryValue } from "./summaries";

const prop = (key: string, type: Property["type"], value: Property["value"]): Property => ({ key, type, value, line: 0, count: 1 });
const file = (path: string, is_dir = false): FileEntry => ({ path, name: path.slice(path.lastIndexOf("/") + 1), is_dir, mtime_ms: 1, ctime_ms: 1, size: 1 });
const row = (path: string, props: Property[] = []): Row => ({ file: file(path), props, tags: [], hasLink: () => false });
const runSync = <T>(work: Generator<void, T>): T => { let step = work.next(); while (!step.done) step = work.next(); return step.value; };
const text = (value: Value) => value instanceof Error ? value.toString() : value;

it("does not list a file named .md as a note", () => {
  const notes = baseNoteFiles([
    file(".md"), file(".MD"), file("Folder/.md"), file("Folder/.MD"), file("Folder", true),
    file("a.md"), file("Note.MD"), file("readme.markdown"), file("photo.png"),
  ], () => false);
  expect(notes.map(f => f.path)).toEqual(["a.md", "Note.MD"]);
  const selected = baseModel("").select(notes.map(f => row(f.path)));
  expect(selected.map(r => r.context.get("file.name"))).toEqual(["a", "Note"]);
  expect(selected.map(r => r.row.file.path)).not.toContain(".md");
});

it("evaluates divide-by-zero, missing names and wrong types as formula columns", () => {
  const source = `formulas:
  boom: '1 / points'
  guarded: 'if(points == 0, 0, 1 / points)'
  uses: 'formula.boom + 1'
  lower: 'note.points.lower()'
  times: 'note.label * 2'
  num: 'number(note.label) * 2'
  year: 'note.due.year'
  self: 'formula.self'
  a: 'formula.b + 1'
  b: 'formula.c + 1'
  c: 'formula.a + 1'
  gone: 'formula.missing'
  score: 'note.n + 1'
  deep: '${Array.from({ length: 51 }, () => "if(true, ").join("")}1${", 0)".repeat(51)}'
views:
  - order: [file.name, formula.boom]
`;
  const chain = Array.from({ length: 40 }, (_, i) => `  f${i}: '${i === 39 ? "note.n + 1" : `formula.f${i + 1} + 1`}'`).join("\n");
  const deep = baseModel(`formulas:\n${chain}\nviews:\n  - order: [formula.f0]\n`);
  const base = baseModel(source);
  const rows = [
    row("A.md", [prop("points", "number", "0"), prop("label", "text", "10"), prop("due", "text", "2024-02-29"), prop("n", "number", "1"), prop("Status", "text", "open")]),
    row("B.md", [prop("points", "number", "4"), prop("label", "text", "10 apples"), prop("due", "text", "2024-02-30"), prop("n", "text", "10")]),
    row("C.md", [prop("label", "text", ""), prop("due", "date", "2024-03-01")]),
  ];
  const selected = base.select(rows);
  const a = selected[0].context, b = selected[1].context;
  expect(text(a.get("formula.boom"))).toBe("#ERROR: Division by zero");
  expect(a.get("formula.guarded")).toBe(0);
  // The error is that row's value. Adding to it fails again. The next row's boom is a number, so the same formula is 1.25 there.
  expect(text(a.get("formula.uses"))).toBe("#ERROR: Division by zero");
  expect(b.get("formula.boom")).toBe(0.25);
  expect(b.get("formula.uses")).toBe(1.25);
  expect(text(a.get("formula.lower"))).toBe("#ERROR: Expected text");
  expect(a.get("formula.gone")).toBe(null);
  expect(text(a.get("formula.times"))).toBe("#ERROR: Expected a number");
  expect(a.get("formula.num")).toBe(20);
  expect(text(b.get("formula.num"))).toBe("#ERROR: Cannot convert value to a number");
  expect(selected[2].context.get("formula.num")).toBe(null);
  expect(a.get("formula.year")).toBe(2024);
  expect(text(b.get("formula.year"))).toBe("#ERROR: Property year is not available on this value");
  expect(selected[2].context.get("formula.year")).toBe(2024);
  expect(a.get("formula.self")).toBe(null);
  expect(a.get("formula.a")).toBe(null);
  expect(a.get("formula.score")).toBe(2);
  expect(a.get("formula.Score")).toBe(null);
  expect(a.get("note.STATUS")).toBe("open");
  expect(a.get("note.n")).toBe(1);
  expect(b.get("note.n")).toBe("10");
  expect(text(a.get("formula.deep"))).toBe(null);
  expect([...base.notices].some(n => n.startsWith("Unsupported expression:"))).toBe(true);
  expect([...base.notices]).toEqual(expect.arrayContaining(["Circular formula: formula.self", "Circular formula: formula.a"]));
  expect([...base.notices].some(n => /formula\.(gone|missing|Score)/.test(n))).toBe(false);
  const chained = deep.select([rows[0]])[0].context.get("formula.f0");
  expect(chained).toBe(41);
  expect(deep.notices.size).toBe(0);
  // A filter that fails on a row does not match it; a missing property compared with null does.
  expect(baseModel(`filters: '1 / 0'`).select(rows)).toEqual([]);
  expect(baseModel(`filters: 'note.absent == null'`).select(rows)).toHaveLength(3);
  expect(baseModel(`filters: 'note.label > 9'`).select(rows)).toEqual([]);
  expect(baseModel(`filters: 'number(note.label) > 9'`).select(rows).map(r => r.row.file.path)).toEqual(["A.md"]);
  expect(baseModel(`filters: 'note.flag == true'`).select([
    row("T.md", [prop("flag", "checkbox", true)]),
    row("S.md", [prop("flag", "text", "true")]),
  ]).map(r => r.row.file.path)).toEqual(["T.md"]);
});

it("sorts numbers and date text by value, and keeps numeric text as text in comparisons", () => {
  const numbered = [
    row("n10.md", [prop("n", "number", "10")]),
    row("n2.md", [prop("n", "number", "2")]),
    row("nblank.md", [prop("n", "number", "")]),
  ];
  const textual = [
    row("t10.md", [prop("n", "text", "10")]),
    row("t2.md", [prop("n", "text", "2")]),
    row("t10a.md", [prop("n", "text", "10a")]),
  ];
  const dates = [
    row("late.md", [prop("due", "text", "2024-03-01")]),
    row("early.md", [prop("due", "text", "2024-02-29")]),
    row("nope.md", [prop("due", "text", "March")]),
  ];
  const by = (rows: Row[], key: string) => baseModel(`views:\n  - sort:\n      - property: ${key}\n        direction: ASC\n`).select(rows).map(r => r.row.file.path);
  expect(by(numbered, "n")).toEqual(["n2.md", "n10.md", "nblank.md"]);
  expect(by(textual, "n")).toEqual(["t2.md", "t10.md", "t10a.md"]);
  expect(by(dates, "due")).toEqual(["early.md", "late.md", "nope.md"]);
  const over = baseModel(`filters: 'n > 9'`);
  expect(over.select(numbered).map(r => r.row.file.path)).toEqual(["n10.md"]);
  expect(over.select(textual)).toEqual([]);
});

it("groups empty, missing and list values apart from case-only text", () => {
  const rows = [
    row("a.md", [prop("status", "text", "open")]),
    row("b.md", [prop("status", "text", "Open")]),
    row("c.md", [prop("status", "text", "OPEN"), prop("tags", "list", ["work", "home"])]),
    row("d.md", [prop("status", "text", ""), prop("tags", "list", ["home", "work"])]),
    row("e.md", [prop("tags", "list", [])]),
    row("f.md", [prop("status", "list", ["Open"])]),
    row("g.md", [prop("status", "list", [])]),
    row("h.md"),
  ];
  const grouped = (key: string) => {
    const model = baseModel(`views:\n  - groupBy:\n      property: ${key}\n      direction: ASC\n`);
    return groupRows(model.select(rows), model.groupBy).map(g => [g.label, g.rows.map(r => r.row.file.path), g.id === "empty"]);
  };
  const status = grouped("status");
  expect(status.at(-1)?.[2]).toBe(true);
  expect(status.at(-1)?.[1]).toEqual(["d.md", "e.md", "g.md", "h.md"]);
  // Case differs, so the text values stay apart. A one-item list displays as that item and still has its own group.
  expect(status.filter(g => !g[2]).map(g => [g[0], g[1]])).toEqual([
    ["open", ["a.md"]],
    ["Open", ["b.md"]],
    ["OPEN", ["c.md"]],
    ["Open", ["f.md"]],
  ]);
  const tags = grouped("tags");
  expect(tags.find(g => g[2])?.[1]).toEqual(["a.md", "b.md", "e.md", "f.md", "g.md", "h.md"]);
  expect(tags.filter(g => !g[2]).map(g => g[0])).toEqual(["home, work", "work, home"]);
  const boom = baseModel(`formulas:\n  boom: '1 / 0'\nviews:\n  - groupBy:\n      property: formula.boom\n`);
  const failed = groupRows(boom.select([row("A.md")]), boom.groupBy);
  expect(failed.map(g => g.id)).toEqual(["empty"]);
  expect(failed[0].error).toBeInstanceOf(Error);
  expect(failed[0].rows).toHaveLength(1);
});

it("keeps emoji and very long text, and stops grouping or searching a value past the cap", () => {
  const emoji = "Naïve 🎉";
  const long = "é".repeat(20_000);
  const huge = "x".repeat(100_001);
  const model = baseModel(`formulas:\n  up: 'note.title.upper()'\n  low: 'note.title.lower()'\nviews:\n  - order: [file.name, title, formula.up]\n`);
  const rows = [
    row("E.md", [prop("title", "text", emoji)]),
    row("L.md", [prop("title", "text", long + "TAIL")]),
    row("H.md", [prop("title", "text", huge), prop("mark", "text", "kept")]),
  ];
  const selected = model.select(rows);
  const at = (path: string) => selected.find(r => r.row.file.path === path)!.context;
  expect(at("E.md").get("formula.up")).toBe("NAÏVE 🎉");
  expect(String(at("L.md").get("formula.low"))).toMatch(/tail$/);
  expect(text(at("H.md").get("formula.low"))).toBe("#ERROR: Formula value is too large");
  const found = runSync(searchWork(selected, "naïve 🎉", e => rowText(e.context, model.columns)));
  expect(found.map(r => r.row.file.path)).toEqual(["E.md"]);
  expect(runSync(searchWork(selected, "tail", e => rowText(e.context, ["title"]))).map(r => r.row.file.path)).toEqual(["L.md"]);
  // The cap skips that one value. Another column on the same row still matches.
  expect(runSync(searchWork(selected, "kept", e => rowText(e.context, ["title", "mark"]))).map(r => r.row.file.path)).toEqual(["H.md"]);
  expect(runSync(searchWork(selected, "xxxx", e => rowText(e.context, ["title"])))).toEqual([]);
  const grouped = groupRows(model.select(rows), { property: "title", direction: "ASC" });
  expect(grouped.find(g => g.rows.some(r => r.row.file.path === "H.md"))).toMatchObject({ id: "empty" });
  expect(grouped.find(g => g.label === emoji)?.rows).toHaveLength(1);
});

it("limits summaries and CSV to the searched rows of an already filtered base", () => {
  const source = `properties:
  note.status:
    displayName: State
  formula.boom:
    displayName: Boom
formulas:
  boom: '1 / points'
views:
  - filters: 'status == "open"'
    order: [file.name, status, points, label, formula.boom]
    summaries:
      points: Sum
      formula.boom: Sum
`;
  const model = baseModel(source);
  const other = baseModel(`views:\n  - order: [status, formula.boom]\nformulas:\n  boom: '1'\n`);
  const rows = [
    row("Alpha.md", [prop("status", "text", "open"), prop("points", "number", "1"), prop("label", "text", "plain")]),
    row("Beta.md", [prop("status", "text", "done"), prop("points", "number", "10"), prop("label", "text", "secret, keep")]),
    row("Quote.md", [prop("status", "text", "open"), prop("points", "number", "4"), prop("label", "text", 'he said "hi",\r\nthen 🎉')]),
    row("Zero.md", [prop("status", "text", "open"), prop("points", "number", "0"), prop("label", "text", "zero")]),
  ];
  const selected = model.select(rows);
  expect(selected.map(r => r.row.file.path)).toEqual(["Alpha.md", "Quote.md", "Zero.md"]);
  const visible = (query: string) => runSync(searchWork(selected, query, e => rowText(e.context, model.columns)));
  const csv = (entries: readonly typeof selected[number][]) => tableCsv(model.columns.map(model.label), entries.map(e => model.columns.map(k => e.context.get(k))));
  const sum = (entries: readonly typeof selected[number][], key: string) => summaryValue(summarize(entries, groupRows(entries, null), model.summaryPlan).all, key);
  const all = visible("");
  expect(sum(all, "points")).toBe(5);
  expect(isFormulaError(sum(all, "formula.boom"))).toBe(true);
  expect(csv(all)).toBe('file name,State,points,label,Boom\nAlpha,open,1,plain,1\nQuote,open,4,"he said ""hi"",\r\nthen 🎉",0.25\nZero,open,0,zero,#ERROR: Division by zero');
  const plain = visible("plain");
  expect(plain.map(r => r.row.file.path)).toEqual(["Alpha.md"]);
  expect(sum(plain, "points")).toBe(1);
  expect(sum(plain, "formula.boom")).toBe(1);
  expect(csv(plain)).toBe("file name,State,points,label,Boom\nAlpha,open,1,plain,1");
  expect(csv(plain)).not.toContain("secret");
  expect(csv(plain)).not.toContain("Beta");
  const quoted = visible("🎉");
  expect(csv(quoted)).toBe('file name,State,points,label,Boom\nQuote,open,4,"he said ""hi"",\r\nthen 🎉",0.25');
  // The display name lives on this base's model. The property value and another base stay as they were.
  expect(model.label("status")).toBe("State");
  expect(model.label("formula.boom")).toBe("Boom");
  expect(other.label("status")).toBe("status");
  expect(other.label("formula.boom")).toBe("boom");
  expect(selected[0].context.get("note.status")).toBe("open");
  expect(selected[0].context.get("status")).toBe("open");
});

it("sorts 10,000 rows inside the 50ms ceiling", () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => row(`N/${String(i).padStart(5, "0")}.md`, [prop("rank", "number", String(i))]));
  const model = baseModel(`views:\n  - order: [file.name, rank]\n    sort:\n      - property: rank\n        direction: DESC\n`);
  const start = performance.now();
  const selected = model.select(rows);
  const ms = performance.now() - start;
  expect(selected[0].context.get("file.name")).toBe("09999");
  expect(selected[0].context.get("rank")).toBe(9999);
  expect(selected[9999].context.get("rank")).toBe(0);
  expect(ms).toBeLessThan(50);
});
