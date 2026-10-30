import { expect, test } from "vitest";
import { formatLink } from "../links/internal";
import { dropLinkText, selectGesture, selectionFolderParent, selectionRange, topLevelPaths, treeKeyAction, type TreeCursor } from "./treeSelect";

test("alt toggles, shift extends, and ctrl or cmd opens instead of selecting", () => {
  const none = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false };
  expect(selectGesture({ ...none, altKey: true })).toBe("toggle");
  expect(selectGesture({ ...none, shiftKey: true })).toBe("range");
  expect(selectGesture({ ...none, altKey: true, shiftKey: true })).toBe("range");
  expect(selectGesture({ ...none, ctrlKey: true })).toBe("open");
  expect(selectGesture({ ...none, metaKey: true, altKey: true })).toBe("open");
  expect(selectGesture(none)).toBe("open");
});

test("shift range is the inclusive visible span, and a missing anchor is just the row", () => {
  const order = ["A", "B", "C", "D"];
  expect(selectionRange(order, "A", "C")).toEqual(["A", "B", "C"]);
  expect(selectionRange(order, "D", "B")).toEqual(["B", "C", "D"]);
  expect(selectionRange(order, null, "B")).toEqual(["B"]);
  expect(selectionRange(order, "Missing", "B")).toEqual(["B"]);
});

test("a selected folder carries its selected children, and sibling files all stay", () => {
  const folder = (path: string) => path === "Sel" || path === "Sel/Nested";
  expect(topLevelPaths(["Sel", "Sel/A.md", "Sel/Nested", "Sel/Nested/B.md", "Other.md"], folder)).toEqual(["Sel", "Other.md"]);
  expect(topLevelPaths(["Sel/A.md", "Sel/B.md"], folder)).toEqual(["Sel/A.md", "Sel/B.md"]);
});

test("a new folder for a selection uses the folder every item already shares", () => {
  expect(selectionFolderParent(["Sel/A.md", "Sel/B.md"])).toBe("Sel");
  expect(selectionFolderParent(["Sel", "Other.md"])).toBe("");
  expect(selectionFolderParent(["A/B/One.md", "A/C/Two.md"])).toBe("A");
  expect(selectionFolderParent([])).toBe("");
});

test("a note drop writes one suggester link per line and embeds other files", () => {
  const notes = [
    { name: "Note", path: "Note.md" },
    { name: "Note", path: "Folder/Note.md" },
    { name: "photo.png", path: "photo.png" },
    { name: "photo.png", path: "Attachments/photo.png" },
    { name: "Upper", path: "Upper.MD" },
  ];
  const style = { format: "shortest" as const, wikilinks: true };
  const linkTo = (target: string, from: string | null) => formatLink(target, from, notes, style);
  const isDir = (path: string) => path === "Projects";
  expect(dropLinkText(["Note.md", "Folder/Note.md", "Upper.MD", "Attachments/photo.png", "Projects"], isDir, "Daily/Today.md", linkTo)).toBe(
    "[[Note]]\n[[Folder/Note]]\n[[Upper]]\n![[Attachments/photo.png]]",
  );
  expect(dropLinkText(["Projects"], isDir, "Daily/Today.md", linkTo)).toBe("");
});

test("a markdown-link drop keeps the setting and still embeds other files", () => {
  const notes = [
    { name: "Ideas", path: "Ideas.md" },
    { name: "photo.png", path: "photo.png" },
  ];
  const style = { format: "shortest" as const, wikilinks: false };
  const linkTo = (target: string, from: string | null) => formatLink(target, from, notes, style);
  expect(dropLinkText(["Ideas.md", "photo.png"], () => false, "Daily/Today.md", linkTo)).toBe("[Ideas](Ideas.md)\n![photo.png](photo.png)");
});

test("explorer keys move, open folders, and delete, and modifiers stay out of it", () => {
  const none = { shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
  const file: TreeCursor = { isFolder: false, expanded: false, hasParent: true, hasChild: false };
  const closed: TreeCursor = { isFolder: true, expanded: false, hasParent: true, hasChild: true };
  const open: TreeCursor = { ...closed, expanded: true };
  expect(treeKeyAction("ArrowDown", none, null)).toEqual({ type: "move", delta: 1, extend: false });
  expect(treeKeyAction("ArrowUp", { ...none, shiftKey: true }, file)).toEqual({ type: "move", delta: -1, extend: true });
  expect(treeKeyAction("ArrowRight", none, closed)).toEqual({ type: "expand" });
  expect(treeKeyAction("ArrowRight", none, open)).toEqual({ type: "child" });
  expect(treeKeyAction("ArrowRight", none, { ...open, hasChild: false })).toBeNull();
  expect(treeKeyAction("ArrowRight", none, file)).toBeNull();
  expect(treeKeyAction("ArrowLeft", none, open)).toEqual({ type: "collapse" });
  expect(treeKeyAction("ArrowLeft", none, file)).toEqual({ type: "parent" });
  expect(treeKeyAction("ArrowLeft", none, { ...file, hasParent: false })).toBeNull();
  expect(treeKeyAction("Enter", none, file)).toEqual({ type: "open" });
  expect(treeKeyAction("Delete", none, file)).toEqual({ type: "delete" });
  expect(treeKeyAction("Backspace", none, file)).toEqual({ type: "delete" });
  expect(treeKeyAction("Backspace", { ...none, shiftKey: true }, file)).toBeNull();
  expect(treeKeyAction("ArrowDown", { ...none, ctrlKey: true }, file)).toBeNull();
  expect(treeKeyAction("a", none, file)).toBeNull();
});
