import { expect, it } from "vitest";
import { FormulaDate, FormulaError, isFormulaError, type Value } from "./expression";
import { groupRows, type Entry } from "./groups";
import { baseModel } from "./model";
import { parseSummaryPlan, summarize, summarizeAsync, summaryValue } from "./summaries";
const entries = (values: Value[]): Entry[] => values.map((value, i) => ({ row: { file: { path: `${i}.md`, name: String(i), is_dir: false, size: 1, mtime_ms: 0, ctime_ms: 0 }, props: [], tags: [], hasLink: () => false }, context: { get: () => value, hasTag: () => false, hasLink: () => false } }));
function result(name: string, values: Value[]) {
  const rows = entries(values), plan = parseSummaryPlan(undefined, { p: name }, new Set());
  return summaryValue(summarize(rows, groupRows(rows, null), plan).all, "p");
}
it.each([
  ["Count", [null, "", [], false, 0], 5], ["Empty", [null, "", [], false, 0, " "], 3], ["Filled", [null, "", [], false, 0, " "], 3],
  ["Unique", [null, "", [], 1, 1, "1", false, 0, [1], [1]], 5],
  ["Sum", [1, 2, null, "5", true], 3], ["Average", [2, 4, "5", null], 3], ["Min", [4, -1, 2], -1], ["Max", [4, -1, 2], 4],
  ["Range", [4, -1, 2], 5], ["Median", [9, 1, 3], 3], ["Median", [9, 1, 3, 5], 4], ["Checked", [true, false, "true", null, true], 2], ["Unchecked", [true, false, "false", null], 1],
])("%s on mixed and empty values", (name, values, expected) => expect(result(name as string, values as Value[])).toEqual(expected));
it.each(["Count", "Empty", "Filled", "Unique", "Sum", "Checked", "Unchecked"])("%s of no rows is zero", name => expect(result(name, [])).toBe(0));
it.each(["Average", "Min", "Max", "Range", "Median", "Earliest", "Latest"])("%s of no suitable values is null", name => expect(result(name, [null, "text", []])).toBeNull());
it("summarizes dates, booleans, lists and error values without coercing text to numbers", () => {
  expect(String(result("Earliest", ["bad", "2024-03-01", "2024-02-29"]))).toBe("2024-02-29");
  expect(result("Latest", [new FormulaDate(0), new FormulaDate(1000)])).toEqual(new FormulaDate(1000));
  expect(result("Sum", [1e308, 1e308])).toBeInstanceOf(FormulaError);
  expect(result("Average", [1e308, 1e308])).toBe(1e308);
  expect(result("Median", [1e308, 1e308])).toBe(1e308);
  const error = new FormulaError("failed cell");
  expect(result("Sum", [error, 2])).toBe(error);
  expect(result("Empty", [error])).toBe(error);
  expect(result("Count", [error])).toBe(1);
});
it("uses B1 custom formulas, typed dates, aggregate getters, lazy branches and dependency errors", () => {
  const rows = entries([1, 4, 7]), groups = groupRows(rows, null);
  const custom = { span: 'max(values) - min(values)', mean: 'sum / count', double: 'formula.span * 2', date: 'date("2024-02-29").year', bad: '1 / 0', depends: 'formula.bad + 1', cycle: 'formula.cycle' };
  for (const [name, expected] of [["span", 6], ["mean", 4], ["double", 12], ["date", 2024]] as const) {
    const plan = parseSummaryPlan(custom, { p: `custom.${name}` }, new Set());
    expect(summaryValue(summarize(rows, groups, plan).all, "p")).toBe(expected);
  }
  for (const name of ["bad", "depends", "cycle", "missing"]) {
    const plan = parseSummaryPlan(custom, { p: `custom.${name}` }, new Set());
    expect(isFormulaError(summaryValue(summarize(rows, groups, plan).all, "p"))).toBe(true);
  }
});
it("respects B1's values-list cap while allowing scalar custom summaries on 50k rows", async () => {
  const rows = entries(Array(50000).fill(2)), groups = groupRows(rows, null);
  for (const [source, expected] of [['sum / count', 2], ['if(count > 10000, count, values.length)', 50000]] as const) {
    const plan = parseSummaryPlan({ large: source }, { p: "large" }, new Set());
    expect(summaryValue((await summarizeAsync(rows, groups, plan)).all, "p")).toBe(expected);
  }
  const plan = parseSummaryPlan({ large: 'values.length' }, { p: "large" }, new Set());
  expect(summaryValue((await summarizeAsync(rows, groups, plan)).all, "p")).toMatchObject({ message: expect.stringContaining("10000") });
});
it("computes per-group and overall totals once per property and yields during medians", async () => {
  const rows = entries(Array.from({ length: 1000 }, (_, i) => i));
  let reads = 0;
  for (const entry of rows) { const get = entry.context.get; entry.context.get = key => { reads++; return get(key); }; }
  const groups = [{ id: "a", label: "a", value: "a", rows: rows.slice(0, 500) }, { id: "b", label: "b", value: "b", rows: rows.slice(500) }];
  const plan = parseSummaryPlan(undefined, { p: "Median" }, new Set());
  let yields = 0;
  const result = await summarizeAsync(rows, groups, plan, { budgetMs: 0, yieldTask: async () => { yields++; } });
  expect(summaryValue(result.all, "p")).toBe(499.5);
  expect(summaryValue(result.groups.get("a")!, "p")).toBe(249.5);
  expect(summaryValue(result.groups.get("b")!, "p")).toBe(749.5);
  expect(reads).toBe(rows.length);
  expect(yields).toBeGreaterThan(10);
  await expect(summarizeAsync(rows, groups, plan, { cancelled: () => true })).rejects.toMatchObject({ name: "AbortError" });
});
it("can receive the embedding host context without reading files", () => {
  const rows = entries([1, 2]), groups = groupRows(rows, null), plan = parseSummaryPlan({ host: 'this.file.name + ":" + count' }, { p: "host" }, new Set());
  const host = { get: () => "Host", hasTag: () => false, hasLink: () => false };
  expect(summaryValue(summarize(rows, groups, plan, host).all, "p")).toBe("Host:2");
});
it("parses view-specific selections, reports bad custom formulas before rows, and preserves source", () => {
  const source = 'summaries:\n  broken: "nope("\nviews:\n  - summaries:\n      p: Sum\n  - summaries:\n      note.p: custom.broken\n';
  const base = baseModel(source, 1);
  expect(base.summaryPlan.selected.get("note.p")).toBe("custom.broken");
  expect([...base.notices].join()).toMatch(/Summary broken/);
  expect(baseModel(source).summaryPlan.selected.get("note.p")).toBe("Sum");
  expect(() => baseModel('views:\n  - summaries: [Sum]')).toThrow(/mapping/);
  expect(() => baseModel('views:\n  - summaries:\n      p: 2')).toThrow(/name/);
});
