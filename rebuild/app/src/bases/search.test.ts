import { expect, it } from "vitest";
import { FormulaDate, FormulaError, type Value } from "./expression";
import { runSync, type Entry } from "./groups";
import { baseModel } from "./model";
import { matchesTerms, rowText, searchTerms, searchWork } from "./search";
import { writeTop } from "./write";
import { readYaml } from "./yaml";

const context = (values: Record<string, Value>) => ({ get: (key: string) => { const v = values[key] ?? null; if (v instanceof Error) throw v; return v; }, hasTag: () => false, hasLink: () => false });
const entry = (path: string, values: Record<string, Value>): Entry => ({ row: { file: { path, name: path, is_dir: false, size: 1, mtime_ms: 0, ctime_ms: 0 }, props: [], tags: [], hasLink: () => false }, context: context(values) });
const search = (rows: Entry[], query: string, keys: string[]) => runSync(searchWork(rows, query, e => rowText(e.context, keys)));

it("splits the query into lower-case words", () => {
  expect(searchTerms("  Alpha   BETA\tgamma ")).toEqual(["alpha", "beta", "gamma"]);
  expect(searchTerms(" \t ")).toEqual([]);
});

it("reads each shown value's text, one per line; checkboxes, empties and errors have none", () => {
  const values: Record<string, Value> = { a: "Hello World", b: 42, c: ["x", "Y"], d: true, e: null, f: new FormulaError("bad"), g: new FormulaDate(Date.UTC(2024, 0, 5)) };
  const text = rowText(context(values), ["a", "b", "c", "d", "e", "f", "missing"], "Title");
  expect(text).toBe("title\nhello world\n42\nx, y");
  expect(rowText(context({ thrown: new Error("boom") as unknown as Value, a: "kept" }), ["thrown", "a"])).toBe("\nkept");
  expect(rowText(context(values), ["g"])).toContain("2024-01-05");
});

it("matches when every word is in the text, in any value, ignoring case", () => {
  const text = rowText(context({ name: "Project Plan", status: "In progress" }), ["name", "status"]);
  expect(matchesTerms(text, searchTerms("plan PROG"))).toBe(true);
  expect(matchesTerms(text, searchTerms("plan done"))).toBe(false);
  // A word can't span two values.
  expect(matchesTerms(text, searchTerms("planin"))).toBe(false);
  expect(matchesTerms(text, [])).toBe(true);
});

it("keeps the rows' order, and only the shown columns count", () => {
  const rows = [entry("1.md", { name: "Alpha", note: "secret" }), entry("2.md", { name: "Beta" }), entry("3.md", { name: "alphabet" })];
  expect(search(rows, "alpha", ["name"]).map(e => e.row.file.path)).toEqual(["1.md", "3.md"]);
  expect(search(rows, "secret", ["name"])).toEqual([]);
  expect(search(rows, "secret", ["name", "note"]).map(e => e.row.file.path)).toEqual(["1.md"]);
  expect(search(rows, "", ["name"])).toBe(rows);
  expect(search(rows, "zzz", ["name"])).toEqual([]);
});

it("yields while filtering many rows", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => entry(`${i}.md`, { name: i % 10 ? "other" : "hit" }));
  const work = searchWork(rows, "hit", e => rowText(e.context, ["name"]));
  let yields = 0, step = work.next();
  while (!step.done) { yields++; step = work.next(); }
  expect(yields).toBe(3);
  expect(step.value).toHaveLength(100);
});

it("writes a display name into `properties`, before `views`, keeping every other byte", () => {
  const source = "# head\nfilters: 'x'\nviews:\n  - type: table\n";
  const added = writeTop(source, "properties", { "note.status": { displayName: "State" } });
  expect(added).toBe("# head\nfilters: 'x'\nproperties:\n  note.status:\n    displayName: State\nviews:\n  - type: table\n");
  expect(baseModel(added).label("status")).toBe("State");
  const replaced = writeTop(added, "properties", { "note.status": { displayName: "Status: now" }, "formula.x": { displayName: "X" } });
  expect(replaced).toBe(source.replace("views:", "properties:\n  note.status:\n    displayName: \"Status: now\"\n  formula.x:\n    displayName: X\nviews:"));
  expect(readYaml(replaced).views).toEqual([{ type: "table" }]);
  expect(writeTop(added, "properties", undefined)).toBe(source);
  expect(writeTop(source, "properties", undefined)).toBe(source);
  expect(writeTop("views: []", "properties", { a: { displayName: "A" } })).toBe("properties:\n  a:\n    displayName: A\nviews: []");
  expect(writeTop("filters: 'x'", "properties", { a: { displayName: "A" } })).toBe("filters: 'x'\nproperties:\n  a:\n    displayName: A\n");
  // A BOM before the first key is kept, and the block is replaced rather than added again (filters too).
  expect(writeTop("\uFEFFfilters: 'a'\nviews: []\n", "filters", "b")).toBe("\uFEFFfilters: b\nviews: []\n");
  expect(writeTop("\uFEFFproperties:\r\n  a:\r\n    displayName: A\r\nviews: []\r\n", "properties", { a: { displayName: "B" } })).toBe("\uFEFFproperties:\r\n  a:\r\n    displayName: B\r\nviews: []\r\n");
});
