import { expect, test, vi } from "vitest";
import type { Tab } from "./tabs";
import { Workspace } from "./workspace";

vi.mock("./api", () => ({ api: {}, isTauri: false }));

test("returning from Reading focuses the active editor after reconfiguration without changing its selection", () => {
  const active = { mode: "live", path: "note.md" } as Tab;
  const order: string[] = [];
  const selection = { anchor: 12, head: 12 };
  const view = { state: { selection }, focus: () => order.push("focus") };
  const ws = { active, view, editors: { showMode: () => order.push("configure") }, emit: () => order.push("mode") } as unknown as Workspace;
  Workspace.prototype.setMode.call(ws, "reading", active);
  expect(order).toEqual(["configure", "mode"]);
  order.length = 0;
  Workspace.prototype.setMode.call(ws, "live", active);
  expect(order).toEqual(["configure", "mode", "focus"]);
  expect(view.state.selection).toBe(selection);
  order.length = 0;
  Workspace.prototype.setMode.call(ws, "source", { mode: "reading", path: "other.md" } as Tab);
  expect(order).toEqual(["configure", "mode"]);
});

test("link formatting qualifies attachment names shared by multiple folders", () => {
  const ws = { vault: { notes: [], files: [
    { name: "photo.png", path: "A/photo.png", is_dir: false },
    { name: "photo.png", path: "B/photo.png", is_dir: false },
  ] }, linkStyle: () => ({ format: "shortest", wikilinks: true }) } as unknown as Workspace;
  expect(Workspace.prototype.linkTo.call(ws, "B/photo.png", "Note.md")).toBe("[[B/photo.png]]");
});

test("canvas wikilinks resolve as attachments instead of creating a markdown note", () => {
  const ws = { vault: { notes: [], files: [{ name: "Board.canvas", path: "Folder/Board.canvas", is_dir: false }] }, active: { path: "Note.md" } } as unknown as Workspace;
  expect(Workspace.prototype.resolve.call(ws, "Board.canvas")).toBe("Folder/Board.canvas");
});
