import { describe, expect, it } from "vitest";
import { compareNames, fileName, isUnder, movedPath, noteName, parentDir, systemPath, trimSlashes } from "./paths";

describe("paths", () => {
  it("names and folders", () => {
    expect(fileName("A/B/Note.md")).toBe("Note.md");
    expect(noteName("A/B/Note.md")).toBe("Note");
    expect(noteName("pic.png")).toBe("pic.png");
    expect(parentDir("A/B/Note.md")).toBe("A/B");
    expect(parentDir("Note.md")).toBe("");
    expect(trimSlashes(" /Daily/notes/ ")).toBe("Daily/notes");
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
