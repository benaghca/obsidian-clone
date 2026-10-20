import { expect, test } from "vitest";
import { fuzzyMatch } from "./fuzzy";

const rank = (query: string, names: string[]) =>
  names
    .map((name) => ({ name, m: fuzzyMatch(query, name) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m!.score - a.m!.score)
    .map((x) => x.name);

test("subsequence matching with indices", () => {
  expect(fuzzyMatch("prd", "Project roadmap")?.indices).toEqual([0, 1, 11]);
  expect(fuzzyMatch("xyz", "Project roadmap")).toBeNull();
});

test("tighter matches rank first", () => {
  expect(rank("road", ["Rad", "Project roadmap", "Ro a d"])).toEqual([
    "Project roadmap",
    "Ro a d",
  ]);
  expect(rank("wel", ["Big note", "Welcome", "Daily well"])).toEqual(["Welcome", "Daily well"]);
});
