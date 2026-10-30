import { expect, it } from "vitest";
import type { Value } from "./expression";
import { groupEntry, withManual } from "./groupMenu";
import { arrangeGroups, groupRows, MANUAL_LIMIT, parseManual, writeViewSetting, type Entry, type RowGroup } from "./groups";
import { baseModel } from "./model";
import { mapping, readYaml } from "./yaml";

const entry = (p: Value): Entry => ({ row: {} as Entry["row"], context: { get: () => p, hasTag: () => false, hasLink: () => false } });
const groups = (values: Value[]) => groupRows(values.map(entry), { property: "p", direction: "ASC" });
const labels = (list: RowGroup[]) => list.map(g => `${g.label}${g.added ? "+" : ""}${g.hidden ? "-" : ""}:${g.rows.length}`);

it("reads no Manual order without an `order` list, and ignores `hidden` then", () => {
  expect(parseManual(undefined)).toBeNull();
  expect(parseManual({ property: "status", direction: "ASC" })).toBeNull();
  expect(parseManual({ property: "status", hidden: ["done"] })).toBeNull();
});

it("arranges listed groups first, then the rest in automatic order; unknown values become empty added groups", () => {
  const auto = groups(["todo", "doing", "done", null, "review", "todo"]);
  expect(labels(auto)).toEqual(["doing:1", "done:1", "review:1", "todo:2", "Empty:1"]);
  const manual = parseManual({ property: "status", order: ["todo", "blocked", null, "doing"], hidden: ["done", "blocked"] });
  expect(labels(arrangeGroups(auto, manual))).toEqual(["todo:2", "blocked+-:0", "Empty:1", "doing:1", "done-:1", "review:1"]);
  // The automatic groups themselves are not changed.
  expect(auto.some(g => g.hidden)).toBe(false);
  expect(arrangeGroups(auto, null)).toBe(auto);
});

it("matches entries by the group's typed key: numbers, booleans, dates and lists", () => {
  const auto = groups([3, 1, true, "2026-11-03", ["work", "home"], ["home"]]);
  const manual = parseManual({ order: [true, ["home"], "2026-11-03", [ "work", "home" ], 1, 3] });
  expect(arrangeGroups(auto, manual).map(g => g.label)).toEqual(["true", "home", "2026-11-03", "work, home", "1", "3"]);
  // A text entry that is a group's label matches when no key does (a formula's link or date).
  const labelled: RowGroup[] = [{ id: "l:\"a.md\"", value: null, label: "Alpha", rows: [] }];
  expect(arrangeGroups(labelled, parseManual({ order: ["Alpha"] }))).toEqual([labelled[0]]);
});

it("skips unreadable entries with a notice, caps Manual at 1,000 groups, and counts duplicates once", () => {
  const manual = parseManual({ order: ["a", { x: 1 }, "a", "b"], hidden: "a" })!;
  expect(manual.order).toHaveLength(2);
  expect(manual.notices).toEqual(["groupBy.order: an entry can't be read", "groupBy.hidden must be a list"]);
  const many = parseManual({ order: Array.from({ length: MANUAL_LIMIT + 5 }, (_, i) => `g${i}`) })!;
  expect(many.order).toHaveLength(MANUAL_LIMIT);
  expect(many.notices).toEqual([`groupBy.order: only the first ${MANUAL_LIMIT} groups are used`]);
});

it("writes each group back as the YAML it was read from, or its value", () => {
  const auto = groups(["todo", 4, null, ["a", "b"]]);
  const manual = parseManual({ order: ['todo'] });
  expect(arrangeGroups(auto, manual).map(g => groupEntry(g, manual))).toEqual(["todo", 4, ["a", "b"], null]);
  expect(withManual({ property: "status", direction: "DESC", order: ["x"], hidden: ["y"], extra: 1 })).toEqual({ property: "status", direction: "DESC", extra: 1 });
  expect(withManual({ property: "status" }, ["a"], [])).toEqual({ property: "status", order: ["a"] });
});

it("round-trips Manual order through the groupBy block, keeping every other byte", () => {
  const source = "# head\nviews:\n  - type: table\n    name: T\n    groupBy:\n      property: status\n      direction: ASC\n    # kept\n";
  const value = withManual(mapping(readYaml(source).views && (readYaml(source).views as never[])[0]).groupBy as never, ["todo", null, 3, true, ["a", "b, c"]], ["done"]);
  const written = writeViewSetting(source, "groupBy", value, 0);
  expect(written).toBe("# head\nviews:\n  - type: table\n    name: T\n    groupBy:\n      property: status\n      direction: ASC\n      order:\n        - todo\n        - null\n        - 3\n        - true\n        - [a, \"b, c\"]\n      hidden:\n        - done\n    # kept\n");
  const model = baseModel(written);
  expect(model.groupBy).toEqual({ property: "status", direction: "ASC" });
  expect(parseManual(model.view.groupBy)!.order).toHaveLength(5);
  // Automatic again: the block loses order and hidden, nothing else.
  expect(writeViewSetting(written, "groupBy", withManual(mapping(model.view.groupBy)), 0)).toBe(source);
});
