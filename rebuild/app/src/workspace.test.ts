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
