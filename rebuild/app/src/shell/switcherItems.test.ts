import { expect, test } from "vitest";
import { switcherItems } from "./switcherItems";

const notes = [
  { name: "Welcome", path: "Welcome.md" },
  { name: "Project roadmap", path: "Projects/Project roadmap.md" },
  { name: "Reading list", path: "Reading list.md" },
  { name: "Ideas", path: "Ideas.md" },
];
const creates = (q: string) => switcherItems(q, notes, [], null).some((i) => i.path === null);

test("no create row while something matches well", () => {
  expect(creates("wel")).toBe(false);
  expect(creates("roadmap")).toBe(false);
  expect(creates("rl")).toBe(false); // Reading list: two word starts
  expect(creates("proj road")).toBe(false); // two word prefixes
  expect(creates("adma")).toBe(false); // a substring of "roadmap"
  expect(creates("welcome")).toBe(false); // exact name
});

test("create row when nothing matches, or only scattered letters do", () => {
  expect(switcherItems("Meeting notes", notes, [], null)).toEqual([{ path: null, name: "Meeting notes", indices: [] }]);
  expect(creates("eoa")).toBe(true); // proj-E-ct r-OA-dmap: mid-word letters only
  const weak = switcherItems("prd", notes, [], null);
  expect(weak.map((i) => i.name)).toEqual(["Project roadmap", "prd"]); // matches first, create last
});

test("empty query lists only recent notes in order, skipping active, missing and duplicate paths", () => {
  const items = switcherItems("", notes, ["Ideas.md", "Welcome.md", "Gone.md", "Ideas.md", "Reading list.md"], "Welcome.md");
  expect(items.map((i) => i.name)).toEqual(["Ideas", "Reading list"]);
});


test("empty or stale recents do not expose unopened notes; typing still searches all notes", () => {
  expect(switcherItems("", notes, [], "Welcome.md")).toEqual([]);
  expect(switcherItems("  ", notes, ["Gone.md", "Welcome.md"], "Welcome.md")).toEqual([]);
  expect(switcherItems("proj", notes, [], "Welcome.md")[0].path).toBe("Projects/Project roadmap.md");
});
