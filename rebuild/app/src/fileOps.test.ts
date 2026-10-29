import { beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { fileSettings, moveFile, renameFile } from "./fileOps";
import type { Workspace } from "./workspace";

vi.mock("./api", () => ({ api: { renamePath: vi.fn().mockResolvedValue(undefined), backlinks: vi.fn().mockResolvedValue({}) } }));
const flush = vi.fn().mockResolvedValue(undefined);
const moved = vi.fn();
const ws = {
  vault: { isFolder: (path: string) => path === "Folder", files: [{ path: "Note.md" }, { path: "Taken.md" }], notes: [] },
  editors: { flush, move: moved }, followMove: vi.fn().mockResolvedValue(undefined),
} as unknown as Workspace;
beforeEach(() => vi.clearAllMocks());

test("invalid names reject without stripping characters or touching files", async () => {
  for (const name of ["", "   ", ".", "..", "a/b", "a\\b", "a:b", "a\nb", "a\0b"]) {
    await expect(renameFile(ws, "Note.md", name)).rejects.toThrow();
  }
  expect(flush).not.toHaveBeenCalled();
  expect(api.renamePath).not.toHaveBeenCalled();
});

test("case-insensitive clashes report the existing destination before saving", async () => {
  await expect(renameFile(ws, "Note.md", "taken")).rejects.toThrow("There's already a file with the same name");
  expect(flush).not.toHaveBeenCalled();
  expect(api.renamePath).not.toHaveBeenCalled();
});

test("valid unicode names and case-only renames keep their existing relocation behavior", async () => {
  await renameFile(ws, "Note.md", " Café ");
  expect(api.renamePath).toHaveBeenLastCalledWith("Note.md", "Café.md");
  await renameFile(ws, "Note.md", "note");
  expect(api.renamePath).toHaveBeenLastCalledWith("Note.md", "note.md");
  await renameFile(ws, "Boards/Map.CANVAS", "Plan");
  expect(api.renamePath).toHaveBeenLastCalledWith("Boards/Map.CANVAS", "Boards/Plan.CANVAS");
  await renameFile(ws, "Folder", "Renamed");
  expect(api.renamePath).toHaveBeenLastCalledWith("Folder", "Renamed");
});


const movingWorkspace = () => ({
  ...ws,
  vault: {
    ...ws.vault,
    files: ["A", "A/Child", "B", "B/A", "B/A 1", "B/Note.md", "B/Note 1.md", "B/Picture.png"].map((path) => ({ path })),
    isFolder: (path: string) => ["A", "A/Child", "B"].includes(path),
  },
}) as unknown as Workspace;

test("moves into a folder itself or a descendant and moves to the current parent are silent no-ops", async () => {
  const moving = movingWorkspace();
  for (const folder of ["A", "A/Child", "a/child", ""]) await moveFile(moving, "A", folder);
  await moveFile(moving, "A/Note.md", "A");
  expect(flush).not.toHaveBeenCalled();
  expect(api.renamePath).not.toHaveBeenCalled();
});

test("colliding moves number notes, folders and attachments before their extension", async () => {
  const moving = movingWorkspace();
  await moveFile(moving, "A/Note.md", "B");
  expect(api.renamePath).toHaveBeenLastCalledWith("A/Note.md", "B/Note 2.md");
  await moveFile(moving, "A", "B");
  expect(api.renamePath).toHaveBeenLastCalledWith("A", "B/A 2");
  await moveFile(moving, "A/Picture.png", "B");
  expect(api.renamePath).toHaveBeenLastCalledWith("A/Picture.png", "B/Picture 1.png");
});

test("a move uses the existing editor, tab and link-following path", async () => {
  const moving = movingWorkspace();
  const renamed = vi.spyOn(fileSettings, "renamed");
  await moveFile(moving, "A/Unique.md", "B");
  expect(api.renamePath).toHaveBeenCalledWith("A/Unique.md", "B/Unique.md");
  expect(moved).toHaveBeenCalledOnce();
  expect(moving.followMove).toHaveBeenCalledOnce();
  expect(renamed).toHaveBeenCalledWith("A/Unique.md", "B/Unique.md", moving.vault.notes, {});
  renamed.mockRestore();
});


test("case-only folder renames remain valid with the relocation guard", async () => {
  await renameFile(movingWorkspace(), "A", "a");
  expect(api.renamePath).toHaveBeenLastCalledWith("A", "a");
});


test("snapshots every moved note before rename and passes the same snapshot after followMove", async () => {
  const moving = movingWorkspace();
  moving.vault.notes = Array.from({ length: 25 }, (_, i) => ({ path: `A/Note${i}.md`, name: `Note${i}` }));
  moving.vault.notes.push({ path: "Outside.md", name: "Outside" });
  const before = moving.vault.notes;
  let release!: (value: Record<string, never[]>) => void;
  const snapshot = { "A/Note0.md": [] };
  vi.mocked(api.backlinks).mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const renamed = vi.spyOn(fileSettings, "renamed");
  const movingNote = moveFile(moving, "A", "B");
  await Promise.resolve();
  expect(api.backlinks).toHaveBeenCalledWith(before.slice(0, 25).map(n => n.path));
  expect(api.renamePath).not.toHaveBeenCalled();
  release(snapshot);
  await movingNote;
  expect(renamed).toHaveBeenCalledWith("A", "B/A 2", before, snapshot);
  expect(vi.mocked(api.backlinks).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.renamePath).mock.invocationCallOrder[0]);
  expect(vi.mocked(moving.followMove).mock.invocationCallOrder[0]).toBeLessThan(renamed.mock.invocationCallOrder[0]);
  renamed.mockRestore();
});

test("a failed backlink snapshot aborts before any path is renamed", async () => {
  const moving = movingWorkspace();
  moving.vault.notes = [{ path: "A/Note.md", name: "Note" }];
  vi.mocked(api.backlinks).mockRejectedValueOnce(new Error("snapshot unavailable"));
  await expect(moveFile(moving, "A/Note.md", "B")).rejects.toThrow("snapshot unavailable");
  expect(api.renamePath).not.toHaveBeenCalled();
  expect(moved).not.toHaveBeenCalled();
});
