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

const noteWantsBase = (text: string) => text.includes("~~~base") || text.includes("```base");

vi.mock("./viewLoad", () => ({
  kindReady: (type?: string) => !type || !gate.heavy.has(type) || gate.ready.has(type),
  notesReady: (notes: readonly string[] = []) => !notes.some(noteWantsBase) || gate.ready.has("base"),
  preloadKinds: (types: Iterable<string | undefined>, notes: readonly string[] = []) => {
    const need = [...types].filter((type): type is string => !!type && gate.heavy.has(type) && !gate.ready.has(type));
    const baseNote = notes.some(noteWantsBase) && !gate.ready.has("base");
    if (!need.length && !baseNote) return Promise.resolve();
    return new Promise<void>((resolve) => {
      gate.waiters.push(() => {
        for (const kind of need) gate.ready.add(kind);
        if (baseNote) gate.ready.add("base");
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

function leaf(path: string | null, type?: Tab["type"], id = path === null ? 2 : 1): Tab {
  return {
    id,
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

function noteHost(paths: string[], active: string, docs: Map<string, string>) {
  const tabs = paths.map((path, index) => leaf(path, undefined, index + 1));
  const layout = new Layout(tabs[0]!);
  const group = layout.activeGroup;
  for (const tab of tabs.slice(1)) layout.addTab(group, tab);
  group.active = tabs.find((tab) => tab.path === active) ?? tabs[0]!;
  const shown: string[] = [];
  const host = Object.assign(Object.create(Workspace.prototype), {
    layout,
    opens: new WeakMap(),
    origins: new WeakMap(),
    closed: [] as unknown[],
    editors: {
      shows: () => false,
      present: () => { shown.push(group.active.path ?? group.active.type ?? "blank"); },
      viewOf: () => ({ focus() {} }),
      rememberTab: () => {},
      drop: () => {},
      doc: (path: string) => {
        const text = docs.get(path);
        return text === undefined ? undefined : { toString: () => text };
      },
      load: vi.fn(async (path: string) => {
        if (!docs.has(path)) docs.set(path, "loaded");
        const text = docs.get(path)!;
        return { doc: { toString: () => text } };
      }),
    },
    settle: () => {},
  });
  return { host, shown, group, tabs };
}

test("a loaded note whose bases are ready commits in this turn", () => {
  gate.ready.add("base");
  const docs = new Map([["Welcome.md", "hello"], ["L2 tilde.md", "Before\n\n~~~base\n"]]);
  const { host, group, tabs } = noteHost(["Welcome.md", "L2 tilde.md"], "Welcome.md", docs);
  Workspace.prototype.activate.call(host as never, tabs[1]);
  expect(group.active).toBe(tabs[1]);
});

test("activating an unloaded base note waits to commit it", async () => {
  const docs = new Map([["Welcome.md", "hello"]]);
  const { host, group, tabs } = noteHost(["Welcome.md", "L2 tilde.md"], "Welcome.md", docs);
  const tilde = tabs[1]!;
  host.editors.load.mockImplementation(async (path: string) => {
    docs.set(path, "Before\n\n~~~base\n");
    return { doc: { toString: () => docs.get(path)! } };
  });
  Workspace.prototype.activate.call(host as never, tilde);
  expect(group.active.path).toBe("Welcome.md");
  await Promise.resolve();
  await Promise.resolve();
  expect(group.active.path).toBe("Welcome.md");
  await flush();
  expect(group.active).toBe(tilde);
});

test("closing onto an unloaded base note waits to commit it", async () => {
  const docs = new Map([["Welcome.md", "hello"]]);
  const { host, group, tabs } = noteHost(["Welcome.md", "L2 tilde.md"], "Welcome.md", docs);
  host.editors.load.mockImplementation(async (path: string) => {
    docs.set(path, "Before\n\n~~~base\n");
    return { doc: { toString: () => docs.get(path)! } };
  });
  Workspace.prototype.closeTabs.call(host as never, [tabs[0]]);
  expect(group.tabs.map((tab) => tab.path)).toEqual(["Welcome.md", "L2 tilde.md"]);
  expect(group.active.path).toBe("Welcome.md");
  await Promise.resolve();
  await Promise.resolve();
  expect(group.active.path).toBe("Welcome.md");
  await flush();
  expect(group.tabs.map((tab) => tab.path)).toEqual(["L2 tilde.md"]);
  expect(group.active.path).toBe("L2 tilde.md");
});

test("a warm close keeps its note when a cold tab was selected first", async () => {
  const a = leaf("A.md", undefined, 1);
  const c = leaf("C.md", undefined, 2);
  const b = leaf(null, "canvas", 3);
  const layout = new Layout(a);
  const group = layout.activeGroup;
  layout.addTab(group, c);
  layout.addTab(group, b, group.tabs.length);
  const shown: string[] = [];
  const host = Object.assign(Object.create(Workspace.prototype), {
    layout,
    opens: new WeakMap(),
    origins: new WeakMap(),
    closed: [] as unknown[],
    editors: {
      shows: () => false,
      present: () => { shown.push(group.active.type ?? group.active.path ?? "blank"); },
      viewOf: () => ({ focus() {} }),
      rememberTab: () => {},
      drop: () => {},
    },
    settle: () => {},
  });
  Workspace.prototype.activate.call(host as never, b);
  expect(group.active).toBe(a);
  Workspace.prototype.closeTabs.call(host as never, [a]);
  expect(group.active).toBe(c);
  expect(group.tabs).toEqual([c, b]);
  await flush();
  expect(group.active).toBe(c);
  expect(shown).not.toContain("canvas");

  gate.ready.delete("canvas");
  const kept = leaf("A.md", undefined, 4);
  const other = leaf("C.md", undefined, 5);
  const canvas = leaf(null, "canvas", 6);
  const layout2 = new Layout(kept);
  const group2 = layout2.activeGroup;
  layout2.addTab(group2, other);
  layout2.addTab(group2, canvas, group2.tabs.length);
  const again = Object.assign(Object.create(Workspace.prototype), {
    layout: layout2,
    opens: new WeakMap(),
    origins: new WeakMap(),
    closed: [] as unknown[],
    editors: host.editors,
    settle: () => {},
  });
  Workspace.prototype.activate.call(again as never, canvas);
  expect(group2.active).toBe(kept);
  Workspace.prototype.closeTabs.call(again as never, [other]);
  expect(group2.active).toBe(kept);
  expect(group2.tabs).toEqual([kept, canvas]);
  await flush();
  expect(group2.active).toBe(canvas);
});

test("history into a warm base note commits in this turn", async () => {
  gate.ready.add("base");
  const docs = new Map([["Welcome.md", "hello"], ["L2 tilde.md", "Before\n\n~~~base\n"]]);
  const { host, group, tabs } = noteHost(["Welcome.md"], "Welcome.md", docs);
  tabs[0]!.back = ["L2 tilde.md"];
  const traveling = Workspace.prototype.travel.call(host as never, -1);
  expect(group.active.path).toBe("L2 tilde.md");
  await traveling;
});

test("history into an unloaded base note waits to present it", async () => {
  const docs = new Map<string, string>([["Welcome.md", "hello"]]);
  const { host, group, tabs } = noteHost(["Welcome.md"], "Welcome.md", docs);
  tabs[0]!.back = ["L2 tilde.md"];
  host.editors.load.mockImplementation(async (path: string) => {
    docs.set(path, "Before\n\n~~~base\n");
    return { doc: { toString: () => docs.get(path)! } };
  });
  host.editors.shows = () => true;
  host.editors.viewOf = () => ({ state: { doc: { length: 0 }, selection: { main: { anchor: 0, head: 0 } } }, focus() {}, dispatch() {} });
  const traveling = Workspace.prototype.travel.call(host as never, -1);
  expect(group.active.path).toBe("Welcome.md");
  await Promise.resolve();
  await Promise.resolve();
  expect(group.active.path).toBe("Welcome.md");
  await flush();
  await traveling;
  expect(group.active.path).toBe("L2 tilde.md");
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
