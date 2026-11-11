import { beforeEach, expect, test, vi } from "vitest";
import { Layout } from "./layout";
import type { Tab } from "./tabs";
import { Workspace } from "./workspace";

const gate = vi.hoisted(() => {
  const ready = new Set<string>();
  const heavy = new Set(["canvas", "base", "drawing", "graph", "localgraph"]);
  const waiters: (() => void)[] = [];
  return {
    ready,
    heavy,
    waiters,
    release() {
      const pending = waiters.splice(0);
      for (const run of pending) run();
    },
  };
});

vi.mock("./api", () => ({ api: {}, isTauri: false }));

vi.mock("./viewLoad", () => ({
  kindReady: (type?: string) => !type || !gate.heavy.has(type) || gate.ready.has(type),
  notesReady: () => true,
  preloadKinds: (types: Iterable<string | undefined>) => {
    const need = [...types].filter((type): type is string => !!type && gate.heavy.has(type) && !gate.ready.has(type));
    if (!need.length) return Promise.resolve();
    return new Promise<void>((resolve) => {
      gate.waiters.push(() => {
        for (const kind of need) gate.ready.add(kind);
        resolve();
      });
    });
  },
}));

beforeEach(() => {
  gate.ready.clear();
  gate.waiters.splice(0);
});

function orderHost() {
  const tab = { path: "Welcome.md", back: [] as string[], forward: [] as string[], pinned: false } as unknown as Tab;
  const group = { active: tab, tabs: [tab] };
  const shown: string[] = [];
  const host = {
    opens: new WeakMap(),
    activeGroup: group,
    layout: {
      groups: () => [group],
      activeGroup: group,
      groupOf: (item: Tab) => (group.tabs.includes(item) ? group : undefined),
    },
    editors: {
      load: vi.fn(),
      shows: () => false,
      present: () => {},
      viewOf: () => ({ state: { doc: { toString: () => "", length: 0, line: () => ({ from: 0, to: 0 }) }, selection: { main: { anchor: 0, head: 0 } } }, focus: vi.fn() }),
    },
    settle: () => {},
    target: () => ({ group, tab, layoutChanged: false }),
    show: () => { shown.push(tab.type ?? "note"); },
    openAttachment: () => { shown.push("canvas"); },
  };
  return { host, shown, tab };
}

function leaf(path: string | null, type?: Tab["type"]): Tab {
  return {
    id: path === null ? 2 : 1,
    path,
    back: [],
    forward: [],
    mode: "live",
    pinned: false,
    backlinks: false,
    memory: null,
    type,
    viewFile: type === "canvas" ? "L2.canvas" : undefined,
  };
}

function layoutHost() {
  const note = leaf("Welcome.md");
  const canvas = leaf(null, "canvas");
  const layout = new Layout(note);
  layout.addTab(layout.activeGroup, canvas);
  const shown: string[] = [];
  // The stub is not a Workspace, so the prototype supplies select, show and
  // the close helpers. Own fields stand in for the ones the constructor sets.
  const host = Object.assign(Object.create(Workspace.prototype), {
    layout,
    opens: new WeakMap(),
    origins: new WeakMap(),
    closed: [] as unknown[],
    editors: {
      shows: () => false,
      present: () => { shown.push(layout.activeGroup.active.type ?? layout.activeGroup.active.path ?? "blank"); },
      viewOf: () => ({ focus() {}, state: { doc: { length: 0, line: () => ({ from: 0, to: 0 }) }, selection: { main: { anchor: 0, head: 0 } } } }),
      rememberTab: () => {},
      drop: () => {},
      load: vi.fn(),
    },
    settle: () => {},
  });
  return { host, shown, note, canvas, group: layout.activeGroup };
}

async function flush() {
  gate.release();
  await Promise.resolve();
  await Promise.resolve();
}

test("a warm graph open replaces a canvas that is still loading", async () => {
  gate.ready.add("graph");
  const { host, shown } = orderHost();
  const opening = Workspace.prototype.open.call(host as never, "Board.canvas");
  Workspace.prototype.openView.call(host as never, "graph");
  expect(shown).toEqual(["graph"]);
  gate.release();
  await opening;
  expect(shown).toEqual(["graph"]);
});

test("opening a graph in a new tab does not cancel a canvas that is still loading", async () => {
  gate.ready.add("graph");
  const { host, shown } = orderHost();
  const opening = Workspace.prototype.open.call(host as never, "Board.canvas");
  Workspace.prototype.openView.call(host as never, "graph", "tab");
  expect(shown).toEqual(["graph"]);
  gate.release();
  await opening;
  expect(shown).toEqual(["graph", "canvas"]);
});

test("activating a cold canvas tab waits to commit it", async () => {
  const { host, shown, note, canvas, group } = layoutHost();
  Workspace.prototype.activate.call(host as never, canvas);
  expect(group.active).toBe(note);
  expect(shown).toEqual([]);
  await flush();
  expect(group.active).toBe(canvas);
  expect(shown).toEqual(["canvas"]);
});

test("closing onto a cold canvas waits, and closing the cold tab itself does not", async () => {
  const { host, note, canvas, group } = layoutHost();
  Workspace.prototype.closeTabs.call(host as never, [canvas]);
  expect(group.tabs).toEqual([note]);
  expect(group.active).toBe(note);

  const again = layoutHost();
  Workspace.prototype.closeTabs.call(again.host as never, [again.note]);
  expect(again.group.tabs).toEqual([again.note, again.canvas]);
  expect(again.group.active).toBe(again.note);
  await flush();
  expect(again.group.tabs).toEqual([again.canvas]);
  expect(again.group.active).toBe(again.canvas);
});
