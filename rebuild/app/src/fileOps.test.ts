import { beforeEach, expect, test, vi } from "vitest";
import { api } from "./api";
import { renameFile } from "./fileOps";
import type { Workspace } from "./workspace";

vi.mock("./api", () => ({ api: { renamePath: vi.fn().mockResolvedValue(undefined) } }));
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
  await expect(renameFile(ws, "Note.md", "taken")).rejects.toThrow('"taken.md" already exists');
  expect(flush).not.toHaveBeenCalled();
  expect(api.renamePath).not.toHaveBeenCalled();
});

test("valid unicode names and case-only renames keep their existing relocation behavior", async () => {
  await renameFile(ws, "Note.md", " Café ");
  expect(api.renamePath).toHaveBeenLastCalledWith("Note.md", "Café.md");
  await renameFile(ws, "Note.md", "note");
  expect(api.renamePath).toHaveBeenLastCalledWith("Note.md", "note.md");
  await renameFile(ws, "Folder", "Renamed");
  expect(api.renamePath).toHaveBeenLastCalledWith("Folder", "Renamed");
});
