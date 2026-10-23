import { expect, test, vi } from "vitest";
import { treeDropTarget, treeScrollSpeed } from "./treeDrag";

vi.mock("../fileOps", () => ({ moveFile: vi.fn() }));

const file = (path: string) => ({ path, is_dir: false });
const folder = (path: string) => ({ path, is_dir: true });

test("folder rows target themselves, file rows target their parent, empty space and root files target root", () => {
  const source = file("A/Note.md");
  expect(treeDropTarget(source, folder("B"))).toBe("B");
  expect(treeDropTarget(source, file("B/Other.md"))).toBe("B");
  expect(treeDropTarget(source, file("Other.md"))).toBe("");
  expect(treeDropTarget(source, null)).toBe("");
  // Own parent is still highlighted; moveFile makes the eventual drop a no-op.
  expect(treeDropTarget(source, folder("A"))).toBe("A");
  expect(treeDropTarget(source, source)).toBe("A");
});

test("a folder refuses itself and every descendant (including case variants), but not similar names", () => {
  const source = folder("A");
  for (const over of [source, folder("A/Child"), file("A/Note.md"), file("A/Child/Note.md"), folder("a/child")]) expect(treeDropTarget(source, over)).toBeNull();
  expect(treeDropTarget(source, folder("AB"))).toBe("AB");
  expect(treeDropTarget(source, null)).toBe("");
});

test("auto-scroll is confined to the 40px edge and accelerates towards it", () => {
  expect(treeScrollSpeed(41)).toBe(0);
  expect(treeScrollSpeed(40)).toBe(200);
  expect(treeScrollSpeed(25)).toBe(500);
  expect(treeScrollSpeed(10)).toBe(1600);
  expect(treeScrollSpeed(0)).toBeLessThan(2400);
});
