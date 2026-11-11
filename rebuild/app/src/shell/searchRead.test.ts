import { expect, test, vi } from "vitest";
import type { FileEntry, SearchNote } from "../api";
import { compareFiles, type SortOrder } from "../paths";
import { searchResults, takeSearchWork } from "./searchRead";

vi.mock("../api", () => ({ api: {}, isTauri: false }));

const file = (path: string, name = path, mtime = 1, ctime = 1): FileEntry =>
  ({ path, name, is_dir: false, mtime_ms: mtime, ctime_ms: ctime, size: 0 });

/** Today's reply: a fresh map of every file, a full entry copy, then the collator. */
function legacy(files: readonly FileEntry[], notes: readonly SearchNote[], excluded: (path: string) => boolean, sort: SortOrder) {
  const entries = new Map(files.filter((f) => !f.is_dir).map((f) => [f.path, f]));
  return notes
    .filter((n) => entries.has(n.path) && !excluded(n.path))
    .map((n) => ({ ...entries.get(n.path)!, count: n.count }))
    .sort(compareFiles(sort))
    .map((n) => [n.path, n.count]);
}

test("search replies keep today's order for every sort, exclusion, and a later time edit", () => {
  const files = [
    file("a.MD", "Note 10", 5, 1),
    file("b.md", "Note 2", 5, 9),
    file("c.md", "note 2", 1, 3),
    { ...file("dir", "dir"), is_dir: true },
    file("d.md", "Zebra", 1, 3),
    file("a.MD", "Later", 8, 4),
  ];
  const notes: SearchNote[] = [
    { path: "a.MD", count: 1 },
    { path: "b.md", count: 2 },
    { path: "c.md", count: 3 },
    { path: "dir", count: 4 },
    { path: "missing.md", count: 5 },
    { path: "d.md", count: 6 },
  ];
  const orders: SortOrder[] = [
    "alphabetical",
    "alphabeticalReverse",
    "byModifiedTime",
    "byModifiedTimeReverse",
    "byCreatedTime",
    "byCreatedTimeReverse",
  ];
  const exclude = (path: string) => path === "d.md";
  for (const sort of orders) {
    expect(searchResults(files, notes, () => false, sort).map((n) => [n.path, n.count])).toEqual(legacy(files, notes, () => false, sort));
    expect(searchResults(files, notes, exclude, sort).map((n) => [n.path, n.count])).toEqual(legacy(files, notes, exclude, sort));
  }
  files[1].mtime_ms = 20;
  files[2].ctime_ms = 30;
  expect(searchResults(files, notes, () => false, "byModifiedTime").map((n) => n.path)).toEqual(legacy(files, notes, () => false, "byModifiedTime").map((n) => n[0]));
  expect(searchResults(files, notes, () => false, "byCreatedTimeReverse").map((n) => n.path)).toEqual(legacy(files, notes, () => false, "byCreatedTimeReverse").map((n) => n[0]));
});

test("an unchanged file list does not rebuild the map or sort with the collator", () => {
  const files = [file("a.md", "A", 1, 2), file("b.md", "B", 3, 4), { ...file("dir"), is_dir: true }];
  const notes: SearchNote[] = [{ path: "a.md", count: 2 }, { path: "b.md", count: 1 }, { path: "gone.md", count: 9 }];
  takeSearchWork();
  searchResults(files, notes, () => false, "alphabetical");
  searchResults(files, notes, () => false, "alphabeticalReverse");
  searchResults(files, notes, (path) => path === "a.md", "byModifiedTime");
  searchResults(files, notes, () => false, "byCreatedTimeReverse");
  expect(takeSearchWork()).toEqual({ mapBuilds: 1, collatorSorts: 1 });
  searchResults(files.slice(), notes, () => false, "alphabetical");
  expect(takeSearchWork()).toEqual({ mapBuilds: 1, collatorSorts: 1 });
  files.push(file("c.md", "C"));
  searchResults(files, [...notes, { path: "c.md", count: 3 }], () => false, "alphabetical");
  expect(takeSearchWork()).toEqual({ mapBuilds: 1, collatorSorts: 1 });
});
