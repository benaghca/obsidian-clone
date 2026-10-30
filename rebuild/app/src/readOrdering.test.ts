import { Text } from "@codemirror/state";
import { beforeEach, expect, it, vi } from "vitest";
import { api, type FileEntry, type LinkIndex, type SearchNote } from "./api";
import { NoteEditors } from "./noteEditors";
import { Vault } from "./vault";
import { Workspace } from "./workspace";
import type { Tab } from "./tabs";
import { searchReader, searchResults } from "./shell/searchRead";
import { createGraphSource } from "./graph/source";
import { defaults, LOCAL_GRAPH } from "./settings/schema";
import { vaultTags } from "./shell/vaultTags";
import { propertyIndex } from "./shell/propertyIndex";

vi.mock("./api", () => ({ api: {
  listFiles: vi.fn(), linkIndex: vi.fn(), readNote: vi.fn(), search: vi.fn(), searchNotes: vi.fn(), searchLines: vi.fn(), searchMatch: vi.fn(), properties: vi.fn(), tags: vi.fn(),
}, isTauri: false }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const file = (path: string): FileEntry => ({ path, name: path, is_dir: false, mtime_ms: 1, ctime_ms: 1, size: 0 });

beforeEach(() => vi.resetAllMocks());

it("keeps newer file and link refreshes when older replies arrive last", async () => {
  const oldFiles = deferred<FileEntry[]>(), newFiles = deferred<FileEntry[]>();
  const oldLinks = deferred<LinkIndex>(), newLinks = deferred<LinkIndex>();
  vi.mocked(api.listFiles).mockReturnValueOnce(oldFiles.promise).mockReturnValueOnce(newFiles.promise);
  vi.mocked(api.linkIndex).mockReturnValueOnce(oldLinks.promise).mockReturnValueOnce(newLinks.promise);
  const changed = vi.fn(), vault = new Vault(changed, async () => {});
  const first = Promise.all([vault.refreshFiles(), vault.refreshLinks()]);
  const second = Promise.all([vault.refreshFiles(), vault.refreshLinks()]);
  newFiles.resolve([file("new.md"), file("Upper.MD")]);
  const links = { outgoing: { "new.md": ["target.md"] } };
  newLinks.resolve(links);
  await second;
  oldFiles.resolve([file("old.md")]); oldLinks.resolve({ outgoing: {} });
  await first;
  expect(vault.notes.map(n => n.path)).toEqual(["new.md", "Upper.MD"]);
  expect(vault.notes[1].name).toBe("Upper");
  expect(vault.links).toBe(links);
  expect(changed.mock.calls).toEqual([["files"], ["links"]]);
});

function reloadHost() {
  let doc = Text.of(["original"]);
  const host = {
    states: new Map([["a.md", true]]), saveTimers: new Map(), reloads: new Map(), loadEpoch: new Map(),
    doc: () => doc,
    change: vi.fn((_path: string, spec: { changes: { insert: string } }) => { doc = Text.of(spec.changes.insert.split("\n")); }),
    events: { saved: vi.fn() },
  };
  return { host, type: () => { doc = Text.of(["unsaved typing"]); }, reload: () => NoteEditors.prototype.reload.call(host as never, "a.md") };
}

it("does not let an older reload replace the newer text", async () => {
  const old = deferred<string>(), latest = deferred<string>();
  vi.mocked(api.readNote).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const { host, reload } = reloadHost();
  const first = reload(), second = reload();
  latest.resolve("latest"); await second;
  old.resolve("old"); await first;
  expect(host.doc().toString()).toBe("latest");
  expect(host.change).toHaveBeenCalledTimes(1);
});

it("preserves typing done while a reload was in flight", async () => {
  const pending = deferred<string>();
  vi.mocked(api.readNote).mockReturnValueOnce(pending.promise);
  const { host, reload, type } = reloadHost();
  const reading = reload(); type(); pending.resolve("disk"); await reading;
  expect(host.doc().toString()).toBe("unsaved typing");
  expect(host.change).not.toHaveBeenCalled();
});

function workspace() {
  const listeners: ((change: string) => void)[] = [];
  const files = [file("a.md")];
  const ws = {
    on: (fn: (change: string) => void) => { listeners.push(fn); return () => {}; },
    vault: { files, includedNotes: () => files },
    editors: { isLoaded: () => false },
  };
  return { ws: ws as never, change: () => listeners.forEach(fn => fn("files")) };
}

it("search view sorts kept files in locale order, retaining backend tie order and exact counts", () => {
  const files = [file("a.MD"), file("b.md"), file("c.md"), { ...file("dir"), is_dir: true }];
  files[0].name = "Note 10"; files[1].name = "Note 2"; files[2].name = "Note 2";
  const notes = ["a.MD", "b.md", "c.md", "dir", "missing.md"].map((path, i) => ({ path, count: i + 1 }));
  expect(searchResults(files, notes, () => false, "alphabetical").map(n => [n.path, n.count])).toEqual([["b.md", 2], ["c.md", 3], ["a.MD", 1]]);
  expect(searchResults(files, notes, path => path === "b.md", "alphabeticalReverse").map(n => n.path)).toEqual(["a.MD", "c.md"]);
  files[0].mtime_ms = 2;
  expect(searchResults(files, notes, () => false, "byModifiedTime")[0].path).toBe("a.MD");
});

it("search view drops an old reply and sends only the newest queued query after flushing saves", async () => {
  const old = deferred<SearchNote[]>(), latest = deferred<SearchNote[]>();
  const flush = vi.fn().mockResolvedValue(undefined), receive = vi.fn(), failed = vi.fn();
  vi.mocked(api.searchNotes).mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const reader = searchReader({ editors: { flush } } as never, receive, failed);
  reader.read({ query: "a", matchCase: false, seq: 1 });
  await vi.waitFor(() => expect(api.searchNotes).toHaveBeenCalledTimes(1));
  reader.read({ query: "al", matchCase: false, seq: 2 });
  reader.read({ query: "Alpha", matchCase: true, seq: 3 });
  expect(api.searchNotes).toHaveBeenCalledTimes(1);
  old.resolve([{ path: "old.md", count: 1 }]);
  await vi.waitFor(() => expect(api.searchNotes).toHaveBeenCalledTimes(2));
  expect(receive).not.toHaveBeenCalled();
  expect(api.searchNotes).toHaveBeenLastCalledWith("Alpha", true);
  latest.resolve([{ path: "Upper.MD", count: 2 }]);
  await vi.waitFor(() => expect(receive).toHaveBeenCalledWith({ query: "Alpha", matchCase: true, seq: 3 }, [{ path: "Upper.MD", count: 2 }]));
  expect(flush).toHaveBeenCalledTimes(2);
  expect(flush.mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(api.searchNotes).mock.invocationCallOrder[1]);
  expect(failed).not.toHaveBeenCalled();
});

it("clearing search during the save flush cancels a pending query", async () => {
  const saving = deferred<void>(), receive = vi.fn();
  const reader = searchReader({ editors: { flush: () => saving.promise } } as never, receive, vi.fn());
  reader.read({ query: "a", matchCase: false, seq: 1 });
  reader.cancel(); saving.resolve();
  await saving.promise; await Promise.resolve();
  expect(api.searchNotes).not.toHaveBeenCalled();
  expect(receive).not.toHaveBeenCalled();
});

it("graph batches only backend queries, reuses matches across options and invalidates after a vault change", async () => {
  const flush = vi.fn().mockResolvedValue(undefined);
  vi.mocked(api.searchMatch).mockResolvedValue([["a.md"]]);
  vi.mocked(api.tags).mockResolvedValue({ "a.md": ["idea"] });
  const { ws } = workspace();
  Object.assign((ws as Workspace).editors, { flush });
  Object.assign((ws as Workspace).vault, { links: { outgoing: {} }, isExcluded: () => false });
  const source = createGraphSource(ws, false);
  const cfg = { ...defaults(LOCAL_GRAPH), search: "alpha", colorGroups: [
    { query: "alpha", color: { a: 1, rgb: 0xff0000 } },
    { query: "file:a", color: { a: 1, rgb: 0 } },
    { query: "", color: { a: 1, rgb: 1 } },
  ] };
  const facts = await source.facts(cfg);
  expect(api.searchMatch).toHaveBeenCalledWith(["alpha"]);
  expect(flush.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.searchMatch).mock.invocationCallOrder[0]);
  const built = source.build(cfg, facts, null, null);
  expect(built.model.nodes.map(n => n.path)).toContain("a.md");
  expect(built.groups.map(g => g.match(built.model.nodes[0]))).toEqual([true, true, true]);
  await source.facts({ ...cfg, showTags: true });
  expect(api.searchMatch).toHaveBeenCalledTimes(1);
  expect(api.tags).toHaveBeenCalledTimes(1);
  source.forget(); await source.facts(cfg);
  expect(api.searchMatch).toHaveBeenCalledTimes(2);
  expect(source.facts({ ...cfg, search: "file:a", colorGroups: [] })).toBeNull();
  expect(source.facts({ ...cfg, search: "", colorGroups: [] })).toBeNull();
});

it("does not evict newer tags when an invalidated request fails later", async () => {
  const old = deferred<Record<string, string[]>>();
  vi.mocked(api.tags).mockReturnValueOnce(old.promise).mockResolvedValue({});
  const { ws, change } = workspace(), tags = vaultTags(ws);
  const first = tags.read().catch(() => null);
  change();
  const second = tags.read();
  await second;
  old.reject(new Error("old request failed")); await first;
  expect(tags.read()).toBe(second);
  expect(api.tags).toHaveBeenCalledTimes(2);
});

it("serializes property reads and re-reads a note changed during the first read", async () => {
  const old = deferred<Record<string, import("./api").NoteProperties>>();
  vi.mocked(api.properties).mockReturnValueOnce(old.promise).mockResolvedValue({ "a.md": { props: [{ key: "status", type: "text", value: "new", line: 0, count: 1 }], lines: ["status: new"] } });
  const { ws } = workspace(), index = propertyIndex(ws);
  const first = index.notes();
  expect(index.notes()).toBe(first);
  (ws as { vault: { files: FileEntry[] } }).vault.files[0].mtime_ms = 2;
  old.resolve({ "a.md": { props: [{ key: "status", type: "text", value: "old", line: 0, count: 1 }], lines: ["status: old"] } }); await first;
  expect((await index.notes()).get("a.md")?.props[0].value).toBe("new");
  expect(api.properties).toHaveBeenCalledTimes(2);
});

function navigationHost() {
  const tab = { path: null, back: [], forward: [], pinned: false } as unknown as Tab;
  const group = { active: tab };
  const shown: string[] = [];
  const host = {
    opens: new WeakMap(), activeGroup: group, layout: { groups: () => [group] },
    editors: {
      load: vi.fn(),
      shows: () => false,
      present: () => {},
      viewOf: () => ({ state: { doc: Text.of(["body"]) }, focus: vi.fn() }),
    },
    settle: () => {},
    target: () => ({ group, tab, layoutChanged: false }), caretIn: () => undefined,
    show: () => { shown.push(tab.path!); },
    openAttachment: () => { shown.push("canvas"); },
  };
  return {
    host, shown, tab, group,
    open: (path: string, opts?: object) => Workspace.prototype.open.call(host as never, path, opts),
  };
}

it("keeps the latest ordinary note navigation when the older note loads last", async () => {
  const old = deferred<unknown>(), latest = deferred<unknown>();
  const { host, shown, open } = navigationHost();
  host.editors.load.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const first = open("old.md"), second = open("new.md");
  latest.resolve({}); await second;
  old.resolve({}); await first;
  expect(shown).toEqual(["new.md"]);
});

it("opening a canvas supersedes an in-flight ordinary note navigation", async () => {
  const pending = deferred<unknown>();
  const { host, shown, open } = navigationHost();
  host.editors.load.mockReturnValueOnce(pending.promise);
  const first = open("old.md");
  await open("Board.canvas"); pending.resolve({}); await first;
  expect(shown).toEqual(["canvas"]);
});

it("still opens an in-flight note when a new tab is opened while it loads", async () => {
  const pending = deferred<unknown>();
  const { host, shown, open } = navigationHost();
  host.editors.load.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({});
  const first = open("old.md");
  await open("tab.md", { where: "tab" });
  pending.resolve({});
  await first;
  expect(shown).toEqual(["tab.md", "old.md"]);
});

it("does not apply history after a newer note open", async () => {
  const history = deferred<unknown>(), opened = deferred<unknown>();
  const { host, shown, tab, open } = navigationHost();
  tab.path = "current.md";
  tab.back = ["older.md"];
  host.editors.load.mockImplementation((path: string) => (path === "older.md" ? history.promise : opened.promise));
  const traveling = Workspace.prototype.travel.call(host as never, -1);
  const opening = open("new.md");
  opened.resolve({});
  await opening;
  history.resolve({});
  await traveling;
  expect(shown).toEqual(["new.md"]);
  expect(tab.path).toBe("new.md");
  // History was not consumed. Opening the note records the one that was on screen.
  expect(tab.back).toEqual(["older.md", "current.md"]);
});

it("lets history supersede an in-flight note open", async () => {
  const history = deferred<unknown>(), opened = deferred<unknown>();
  const { host, shown, tab, open } = navigationHost();
  tab.path = "current.md";
  tab.back = ["older.md"];
  host.editors.load.mockImplementation((path: string) => (path === "older.md" ? history.promise : opened.promise));
  const opening = open("new.md");
  const traveling = Workspace.prototype.travel.call(host as never, -1);
  history.resolve({});
  await traveling;
  opened.resolve({});
  await opening;
  expect(shown).toEqual([]);
  expect(tab.path).toBe("older.md");
});

it("does not reopen a closed tab over a note opened while it loaded", async () => {
  const closedRead = deferred<unknown>(), opened = deferred<unknown>();
  const { host, shown, group, open } = navigationHost();
  const closedTab = { path: "closed.md", back: [], forward: [], pinned: false };
  const layout = host.layout as { groups: () => unknown[]; addTab: ReturnType<typeof vi.fn> };
  const restored = host as typeof host & { closed: unknown[]; loadTab: () => unknown; select: () => void };
  restored.closed = [{ saved: {}, group, index: 0 }];
  restored.loadTab = () => closedTab;
  layout.addTab = vi.fn();
  restored.select = () => { shown.push("closed"); };
  host.editors.load.mockImplementation((path: string) => (path === "closed.md" ? closedRead.promise : opened.promise));
  const restoring = Workspace.prototype.undoCloseTab.call(host as never);
  const opening = open("new.md");
  opened.resolve({});
  await opening;
  closedRead.resolve({});
  await restoring;
  expect(shown).toEqual(["new.md"]);
  expect(layout.addTab).not.toHaveBeenCalled();
  expect(restored.closed).toHaveLength(1);
});

it("does not publish a note read that lost a disk change while it was in flight", async () => {
  const stale = deferred<string>(), fresh = deferred<string>();
  vi.mocked(api.readNote).mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
  const editors = new NoteEditors({} as never, { shown() {}, loaded() {}, changed() {}, saved() {} });
  const loading = editors.load("a.md");
  const reloading = editors.reload("a.md");
  stale.resolve("stale");
  fresh.resolve("fresh");
  await reloading;
  expect((await loading)?.doc.toString()).toBe("fresh");
});
