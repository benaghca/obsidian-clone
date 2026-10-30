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
