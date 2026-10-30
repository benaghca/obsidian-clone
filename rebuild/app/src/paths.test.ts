import { describe, expect, it } from "vitest";
import { compareFiles, compareNames, fileName, isNoteFile, isUnder, movedPath, noteName, parentDir, SORT_ORDERS, type SortOrder, systemPath, trimSlashes } from "./paths";

describe("paths", () => {
  it("names and folders", () => {
    expect(fileName("A/B/Note.md")).toBe("Note.md");
    expect(noteName("A/B/Note.md")).toBe("Note");
    expect(noteName("Folder/Upper.MD")).toBe("Upper");
    expect(noteName("pic.png")).toBe("pic.png");
    expect(noteName("Upper.MD")).toBe("Upper");
    expect(noteName(".MD")).toBe(".MD");
    expect(isNoteFile("Note.md")).toBe(true);
    expect(isNoteFile("Upper.MD")).toBe(true);
    expect(isNoteFile("a.Md")).toBe(true);
    expect(isNoteFile("photo.png")).toBe(false);
    expect(isNoteFile("Board.canvas")).toBe(false);
    expect(isNoteFile("readme.markdown")).toBe(false);
    expect(parentDir("A/B/Note.md")).toBe("A/B");
    expect(parentDir("Note.md")).toBe("");
    expect(trimSlashes(" /Daily/notes/ ")).toBe("Daily/notes");
  });

  it("a file named .md is not a note", () => {
    expect(isNoteFile("Note.md")).toBe(true);
    expect(isNoteFile("Folder/Upper.MD")).toBe(true);
    expect(isNoteFile("a.md")).toBe(true);
    expect(isNoteFile(".md")).toBe(false);
    expect(isNoteFile(".MD")).toBe(false);
    expect(isNoteFile("Folder/.md")).toBe(false);
    expect(isNoteFile("readme.markdown")).toBe(false);
    expect(isNoteFile("photo.png")).toBe(false);
  });

  it("moves follow a folder, not a name that starts the same", () => {
    expect(isUnder("Box", "Box")).toBe(true);
    expect(isUnder("Box/a.md", "Box")).toBe(true);
    expect(isUnder("Boxes/a.md", "Box")).toBe(false);
    expect(movedPath("Box/a.md", "Box", "Crate")).toBe("Crate/a.md");
    expect(movedPath("Boxes/a.md", "Box", "Crate")).toBe("Boxes/a.md");
  });

  it("system paths and name order", () => {
    expect(systemPath("/home/v", "A/B.md")).toBe("/home/v/A/B.md");
    expect(systemPath("C:\\v", "A/B.md")).toBe("C:\\v\\A\\B.md");
    expect(["Note 10", "note 2", "Apple"].sort(compareNames)).toEqual(["Apple", "note 2", "Note 10"]);
  });
});

it("files in Obsidian's six sort orders, ties by name", () => {
  const files = [
    { name: "b", mtime_ms: 3, ctime_ms: 1 },
    { name: "a", mtime_ms: 1, ctime_ms: 3 },
    { name: "Note 10", mtime_ms: 2, ctime_ms: 2 },
    { name: "Note 2", mtime_ms: 2, ctime_ms: 2 },
  ];
  const sorted = (order: SortOrder) => [...files].sort(compareFiles(order)).map((f) => f.name);
  expect(SORT_ORDERS.map(([o]) => sorted(o))).toEqual([
    ["a", "b", "Note 2", "Note 10"],
    ["Note 10", "Note 2", "b", "a"],
    ["b", "Note 2", "Note 10", "a"],
    ["a", "Note 2", "Note 10", "b"],
    ["a", "Note 2", "Note 10", "b"],
    ["b", "Note 2", "Note 10", "a"],
  ]);
});
