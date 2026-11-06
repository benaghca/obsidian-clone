import { beforeEach, expect, test, vi } from "vitest";
import { updateNoteText } from "../fileOps";
import type { Workspace } from "../workspace";
import { updateLinks } from "./update";

vi.mock("../fileOps", () => ({ updateNoteText: vi.fn().mockResolvedValue(undefined) }));
const style = { format: "shortest", wikilinks: true } as const;
beforeEach(() => vi.clearAllMocks());

test("rewrites from a pre-rename source list", async () => {
  const before = [{ path: "Old.md", name: "Old" }, { path: "Source.md", name: "Source" }];
  const ws = {
    vault: { notes: [{ path: "New.md", name: "New" }, before[1]], links: { outgoing: {} } },
    editors: { text: vi.fn().mockResolvedValue("[[Old]] and [label](Old.md#Heading)") },
  } as unknown as Workspace;
  const ask = vi.fn().mockResolvedValue(true);
  expect(await updateLinks(ws, "Old.md", "New.md", before, ["Source.md"], style, ask)).toBe(2);
  expect(ask).toHaveBeenCalledWith(2, 1);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Source.md", "[[New]] and [label](New.md#Heading)");
});

test("maps sources inside a moved folder forward exactly once and uses live editor text", async () => {
  const before = [{ path: "Old/Target.md", name: "Target" }, { path: "Old/Source.md", name: "Source" }];
  const ws = {
    vault: { notes: before.map(n => ({ ...n, path: n.path.replace("Old/", "New/") })), links: { outgoing: {} } },
    editors: { text: vi.fn().mockResolvedValue("unsaved [[Old/Target]]") },
  } as unknown as Workspace;
  expect(await updateLinks(ws, "Old", "New", before, ["Old/Source.md"], style, null)).toBe(1);
  expect(ws.editors.text).toHaveBeenCalledWith("New/Source.md");
  expect(updateNoteText).toHaveBeenCalledWith(ws, "New/Source.md", "unsaved [[Target]]");
});

test("declining the rename-link confirmation leaves source text untouched", async () => {
  const before = [{ path: "Old.md", name: "Old" }, { path: "Source.md", name: "Source" }];
  const ws = { vault: { notes: [{ path: "New.md", name: "New" }, before[1]] }, editors: { text: async () => "[[Old]]" } } as unknown as Workspace;
  expect(await updateLinks(ws, "Old.md", "New.md", before, ["Source.md"], style, async () => false)).toBe(0);
  expect(updateNoteText).not.toHaveBeenCalled();
});

test("a 50-note folder move rewrites every linking note", async () => {
  const moved = Array.from({ length: 50 }, (_, i) => ({ path: `Old/Note${i}.md`, name: `Note${i}` }));
  const linkers = Array.from({ length: 50 }, (_, i) => ({ path: `Link${i}.md`, name: `Link${i}` }));
  const before = [...moved, ...linkers];
  const after = before.map((n) => n.path.startsWith("Old/") ? { ...n, path: `New/${n.path.slice(4)}` } : n);
  const ws = {
    vault: { notes: after },
    editors: {
      text: vi.fn(async (path: string) => {
        const i = /^Link(\d+)\.md$/.exec(path)?.[1];
        return i === undefined ? "" : `[[Old/Note${i}]]`;
      }),
    },
  } as unknown as Workspace;
  expect(await updateLinks(ws, "Old", "New", before, linkers.map((n) => n.path), style, null)).toBe(50);
  expect(updateNoteText).toHaveBeenCalledTimes(50);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Link0.md", "[[Note0]]");
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Link49.md", "[[Note49]]");
});

test("renaming a drawing rewrites its embeds, keeps their size, and leaves a same-named note's links", async () => {
  const before = [
    { path: "Sketch.md", name: "Sketch" },
    { path: "Source.md", name: "Source" },
    { path: "Sketch.excalidraw", name: "Sketch.excalidraw" },
  ];
  const ws = {
    vault: { notes: before.slice(0, 2) },
    editors: { text: vi.fn().mockResolvedValue("![[Sketch.excalidraw]]\n![[Sketch.excalidraw|400]] [[Sketch]] ![[Sketch]]\n![drawn](Sketch.excalidraw)") },
  } as unknown as Workspace;
  expect(await updateLinks(ws, "Sketch.excalidraw", "Plan 2.excalidraw", before, ["Source.md"], style, null)).toBe(3);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Source.md", "![[Plan 2.excalidraw]]\n![[Plan 2.excalidraw|400]] [[Sketch]] ![[Sketch]]\n![drawn](Plan%202.excalidraw)");
});

test("a drawing moved into a folder with a same-named drawing is linked by its path", async () => {
  const before = [
    { path: "Source.md", name: "Source" },
    { path: "Sketch.excalidraw", name: "Sketch.excalidraw" },
    { path: "Other/Sketch.excalidraw", name: "Sketch.excalidraw" },
  ];
  const ws = {
    vault: { notes: before.slice(0, 1) },
    editors: { text: vi.fn().mockResolvedValue("![[Sketch.excalidraw]] and ![[Other/Sketch.excalidraw|200]]") },
  } as unknown as Workspace;
  // Shortest: the bare name now matches two drawings, so the moved one is written as its path.
  expect(await updateLinks(ws, "Sketch.excalidraw", "Archive/Sketch.excalidraw", before, ["Source.md"], style, null)).toBe(1);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Source.md", "![[Archive/Sketch.excalidraw]] and ![[Other/Sketch.excalidraw|200]]");
});

test("a folder move rewrites links to its notes and embeds of its drawings together", async () => {
  const before = [
    { path: "Old/Note.md", name: "Note" },
    { path: "Old/Map.excalidraw", name: "Map.excalidraw" },
    { path: "Index.md", name: "Index" },
  ];
  const ws = {
    vault: { notes: [{ path: "New/Note.md", name: "Note" }, before[2]] },
    editors: { text: vi.fn().mockResolvedValue("[[Old/Note]] ![[Old/Map.excalidraw]]") },
  } as unknown as Workspace;
  const ask = vi.fn().mockResolvedValue(true);
  expect(await updateLinks(ws, "Old", "New", before, ["Index.md"], { format: "absolute", wikilinks: true }, ask)).toBe(2);
  expect(ask).toHaveBeenCalledWith(2, 1);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Index.md", "[[New/Note]] ![[New/Map.excalidraw]]");
});

test("renaming a note leaves embeds of a drawing with the same stem alone", async () => {
  const before = [{ path: "Sketch.md", name: "Sketch" }, { path: "Source.md", name: "Source" }, { path: "Sketch.excalidraw", name: "Sketch.excalidraw" }];
  const ws = {
    vault: { notes: [{ path: "Renamed.md", name: "Renamed" }, before[1]] },
    editors: { text: vi.fn().mockResolvedValue("[[Sketch]] ![[Sketch.excalidraw|300]]") },
  } as unknown as Workspace;
  expect(await updateLinks(ws, "Sketch.md", "Renamed.md", before, ["Source.md"], style, null)).toBe(1);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Source.md", "[[Renamed]] ![[Sketch.excalidraw|300]]");
});
