import { expect, it } from "vitest";
import { FormulaDate, FormulaDuration, FormulaError, FormulaLink, type Value } from "./expression";
import { baseModel } from "./model";
import { groupRows, groupRowsAsync, parseGroupBy, valueKey, writeViewSetting, type Entry } from "./groups";
import { readYaml, type Yaml } from "./yaml";
const entries = (values: Value[]): Entry[] => values.map((value, i) => ({ row: { file: { path: `${i}.md`, name: String(i), is_dir: false, size: 1, mtime_ms: 0, ctime_ms: 0 }, props: [], tags: [], hasLink: () => false }, context: { get: () => value, hasTag: () => false, hasLink: () => false } }));

it.each(["ASC", "DESC"] as const)("groups %s, preserves row sort and puts empties last", direction => {
  const rows = entries([2, null, 1, 2, "", [], 0, false]);
  const grouped = groupRows(rows, { property: "p", direction });
  expect(grouped.at(-1)?.id).toBe("empty");
  expect(grouped.at(-1)?.rows.map(e => e.row.file.path)).toEqual(["1.md", "4.md", "5.md"]);
  expect(grouped.find(g => g.value === 2)?.rows.map(e => e.row.file.path)).toEqual(["0.md", "3.md"]);
  expect(grouped.filter(g => typeof g.value === "number").map(g => g.value)).toEqual(direction === "ASC" ? [0, 1, 2] : [2, 1, 0]);
  expect(rows.map(e => e.row.file.path)).toEqual(rows.map((_, i) => `${i}.md`));
  expect(groupRows(rows, null)[0].rows).toBe(rows);
});
it("uses bounded structural keys for lists, dates and links, with primitive types distinct", () => {
  expect(valueKey([1, "a"])).toBe(valueKey([1, "a"]));
  expect(valueKey([1, "a"])).not.toBe(valueKey(["1", "a"]));
  expect(valueKey([1, 2])).not.toBe(valueKey([2, 1]));
  expect(valueKey(new FormulaLink("A.md", "Alias"))).toBe(valueKey(new FormulaLink("A.md")));
  expect(valueKey(new FormulaDate(0))).toBe(valueKey("1970-01-01T00:00:00.000Z"));
  expect(valueKey(new FormulaDuration(0, 1, 0))).toBe(valueKey(new FormulaDuration(0, 0, 86400000)));
  expect(valueKey(undefined as unknown as Value)).toBe("empty");
  expect(valueKey(["alpha", "beta"])).toBe(valueKey(["alpha", "beta"]));
  expect(valueKey(["alpha", "beta"])).not.toBe(valueKey([["alpha"], "beta"]));
  expect(valueKey([""])).toBe(valueKey([null]));
  expect(valueKey(["1970-01-01T00:00:00.000Z"])).toBe(valueKey([new FormulaDate(0)]));
  const cycle: Value[] = []; cycle.push(cycle);
  expect(() => valueKey(cycle)).toThrow(/Cyclic/);
  expect(() => valueKey(Array(10001).fill(1))).toThrow(/large/);
  expect(() => valueKey(["x".repeat(60000), "y".repeat(60000)])).toThrow(/large/);
  expect(groupRows(entries([new FormulaError("bad"), null]), { property: "p", direction: "ASC" })).toHaveLength(1);
});
it("parses grouping by view and rejects malformed configurations", () => {
  expect(baseModel('views:\n  - groupBy:\n      property: note.status\n      direction: DESC\n').groupBy).toEqual({ property: "note.status", direction: "DESC" });
  expect(baseModel('views:\n  - name: A\n  - groupBy:\n      property: p\n', 1).groupBy).toEqual({ property: "p", direction: "ASC" });
  expect(parseGroupBy(undefined)).toBeNull();
  const invalids: Yaml[] = [true, "p", [], {}, { property: "" }, { property: "  " }];
  for (const invalid of invalids) expect(() => parseGroupBy(invalid)).toThrow(/groupBy/);
  const notices = new Set<string>();
  expect(parseGroupBy({ property: "p", direction: "backward" }, notices)).toEqual({ property: "p", direction: "ASC" });
  expect([...notices]).toEqual(["Unsupported group direction: backward"]);
  notices.clear();
  const manual: Yaml = { property: "p", direction: "DESC", order: ["todo"], hidden: ["done"] };
  expect(parseGroupBy(manual, notices)).toEqual({ property: "p", direction: "DESC" });
  expect([...notices]).toEqual([]);
  expect(manual).toEqual({ property: "p", direction: "DESC", order: ["todo"], hidden: ["done"] });
  notices.clear();
  expect(parseGroupBy({ property: "p", direction: "DESC", order: ["todo"], hidden: ["done"], width: 3 }, notices)).toEqual({ property: "p", direction: "DESC" });
  expect([...notices]).toEqual(["Unsupported groupBy settings: width"]);
  expect(parseGroupBy({ property: "p", direction: "backward", order: ["todo"] })).toEqual({ property: "p", direction: "ASC" });
  expect(parseGroupBy({ property: "p", direction: null })).toEqual({ property: "p", direction: "ASC" });
  const opened = baseModel('views:\n  - groupBy:\n      property: p\n      direction: backward\n      order:\n        - todo\n      hidden:\n        - done\n  - type: table\n    name: Table\n');
  expect(opened.groupBy).toEqual({ property: "p", direction: "ASC" });
  expect([...opened.notices]).toEqual(["Unsupported group direction: backward"]);
  const stored = opened.view.groupBy;
  if (stored == null || typeof stored !== "object" || Array.isArray(stored)) throw new Error("groupBy was dropped");
  expect(stored.order).toEqual(["todo"]);
  expect(stored.hidden).toEqual(["done"]);
  expect(stored.direction).toBe("backward");
  expect(baseModel('views:\n  - groupBy:\n      property: p\n      direction: backward\n      order:\n        - todo\n      hidden:\n        - done\n  - type: table\n    name: Table\n', 1).notices.size).toBe(0);
});
it("yields and cancels large group work, with identical synchronous order", async () => {
  const rows = entries(Array.from({ length: 3000 }, (_, i) => i % 37));
  const config = { property: "p", direction: "DESC" } as const;
  let yields = 0;
  expect(await groupRowsAsync(rows, config, { budgetMs: 0, yieldTask: async () => { yields++; } })).toEqual(groupRows(rows, config));
  expect(yields).toBeGreaterThan(10);
  await expect(groupRowsAsync(rows, config, { cancelled: () => true })).rejects.toMatchObject({ name: "AbortError" });
});

it("writes only the selected group/summary block, preserving comments, other views and CRLF", () => {
  const source = '# keep\r\nfilters: \'status != "done"\'\r\nsummaries:\r\n  span: \'max(values) - min(values)\'\r\nviews:\r\n  - type: table\r\n    name: First\r\n    groupBy:\r\n      property: old\r\n      direction: ASC\r\n    # after group\r\n    extra: [x, y]\r\n  - type: cards\r\n    name: Other\r\n# tail\r\n';
  const next = writeViewSetting(source, "groupBy", { property: "note.status", direction: "DESC" });
  expect(next).toBe(source.replace('property: old\r\n      direction: ASC', 'property: note.status\r\n      direction: DESC'));
  expect(writeViewSetting(source, "groupBy", undefined)).toBe(source.replace('    groupBy:\r\n      property: old\r\n      direction: ASC\r\n', ''));
  const summaries = writeViewSetting(source, "summaries", { "note.cost": "Sum", "formula.x": "custom.span" }, 1);
  expect(summaries).toBe(source.replace('# tail', '    summaries:\r\n      note.cost: Sum\r\n      formula.x: custom.span\r\n# tail'));
  expect(readYaml(summaries).summaries).toEqual(readYaml(source).summaries);
  expect(writeViewSetting(source, "summaries", undefined, 1)).toBe(source);
});
it.each(["", "# header", "\uFEFFviews: []\r\n# tail\r\n", "views:\n  - name: First"])("supports default/empty/unterminated view %s", source => {
  const next = writeViewSetting(source, "groupBy", { property: "p", direction: "ASC" });
  expect(baseModel(next).groupBy).toEqual({ property: "p", direction: "ASC" });
  if (source.startsWith("\uFEFF")) expect(next.startsWith("\uFEFF")).toBe(true);
});
it("handles a quoted inline first key and no final newline", () => {
  const source = 'views:\n  - "groupBy":\n      property: old';
  expect(writeViewSetting(source, "groupBy", { property: "new", direction: "DESC" })).toBe('views:\n  - groupBy:\n      property: new\n      direction: DESC');
  expect(() => writeViewSetting(source, "summaries", {}, 2)).toThrow(/View/);
});
