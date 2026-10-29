import { beforeEach, expect, test, vi } from "vitest";
import { api } from "../api";
import { updateNoteText } from "../fileOps";
import type { Workspace } from "../workspace";
import { updateLinks } from "./update";

vi.mock("../api", () => ({ api: { search: vi.fn().mockResolvedValue([]), backlinks: vi.fn().mockResolvedValue({}) } }));
vi.mock("../fileOps", () => ({ updateNoteText: vi.fn().mockResolvedValue(undefined) }));
beforeEach(() => vi.clearAllMocks());
const style = { format: "shortest", wikilinks: true } as const;

test("rewrites from a pre-rename backlink snapshot even when fresh backlinks and search are empty", async () => {
  const before = [{ path: "Old.md", name: "Old" }, { path: "Source.md", name: "Source" }];
  const ws = {
    vault: { notes: [{ path: "New.md", name: "New" }, before[1]], links: { outgoing: {} } },
    editors: { text: vi.fn().mockResolvedValue("[[Old]] and [label](Old.md#Heading)") },
  } as unknown as Workspace;
  const snapshot = { "Old.md": [{ from: "Source.md", line: 1, text: "saved source line" }] };
  const ask = vi.fn().mockResolvedValue(true);
  expect(await updateLinks(ws, "Old.md", "New.md", before, snapshot, style, ask)).toBe(2);
  expect(ask).toHaveBeenCalledWith(2, 1);
  expect(updateNoteText).toHaveBeenCalledWith(ws, "Source.md", "[[New]] and [label](New.md#Heading)");
  expect(api.backlinks).not.toHaveBeenCalled();
});

test("maps snapshot sources inside a moved folder forward exactly once and uses live editor text", async () => {
  const before = [{ path: "Old/Target.md", name: "Target" }, { path: "Old/Source.md", name: "Source" }];
  const ws = {
    vault: { notes: before.map(n => ({ ...n, path: n.path.replace("Old/", "New/") })), links: { outgoing: {} } },
    editors: { text: vi.fn().mockResolvedValue("unsaved [[Old/Target]]") },
  } as unknown as Workspace;
  const snapshot = { "Old/Target.md": [{ from: "Old/Source.md", line: 1, text: "older saved line" }] };
  expect(await updateLinks(ws, "Old", "New", before, snapshot, style, null)).toBe(1);
  expect(ws.editors.text).toHaveBeenCalledWith("New/Source.md");
  expect(updateNoteText).toHaveBeenCalledWith(ws, "New/Source.md", "unsaved [[Target]]");
});

test("declining the rename-link confirmation leaves source text untouched", async () => {
  const before = [{ path: "Old.md", name: "Old" }, { path: "Source.md", name: "Source" }];
  const ws = { vault: { notes: [{ path: "New.md", name: "New" }, before[1]] }, editors: { text: async () => "[[Old]]" } } as unknown as Workspace;
  expect(await updateLinks(ws, "Old.md", "New.md", before, { "Old.md": [{ from: "Source.md", line: 1, text: "[[Old]]" }] }, style, async () => false)).toBe(0);
  expect(updateNoteText).not.toHaveBeenCalled();
});
