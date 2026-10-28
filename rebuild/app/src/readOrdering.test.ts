import { Text } from "@codemirror/state";
import { beforeEach, expect, it, vi } from "vitest";
import { api, type FileEntry, type LinkIndex, type SearchHit } from "./api";
import { NoteEditors } from "./noteEditors";
import { Vault } from "./vault";
import { Workspace } from "./workspace";
import type { Tab } from "./tabs";
import { searchFacts } from "./shell/searchFacts";
import { parseQuery } from "./shell/searchQuery";
import { vaultTags } from "./shell/vaultTags";
import { propertyIndex } from "./shell/propertyIndex";

vi.mock("./api", () => ({ api: {
  listFiles: vi.fn(), linkIndex: vi.fn(), readNote: vi.fn(), search: vi.fn(), frontmatter: vi.fn(),
}, isTauri: false }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const file = (path: string): FileEntry => ({ path, name: path, is_dir: false, mtime_ms: 1, ctime_ms: 1, size: 0 });
const hit = (text: string): SearchHit => ({ path: "a.md", line: 1, text });

beforeEach(() => vi.resetAllMocks());

it("keeps newer file and link refreshes when older replies arrive last", async () => {
  const oldFiles = deferred<FileEntry[]>(), newFiles = deferred<FileEntry[]>();
  const oldLinks = deferred<LinkIndex>(), newLinks = deferred<LinkIndex>();
  vi.mocked(api.listFiles).mockReturnValueOnce(oldFiles.promise).mockReturnValueOnce(newFiles.promise);
  vi.mocked(api.linkIndex).mockReturnValueOnce(oldLinks.promise).mockReturnValueOnce(newLinks.promise);
  const changed = vi.fn(), vault = new Vault(changed, async () => {});
  const first = Promise.all([vault.refreshFiles(), vault.refreshLinks()]);
  const second = Promise.all([vault.refreshFiles(), vault.refreshLinks()]);
  newFiles.resolve([file("new.md")]);
  const links = { outgoing: { "new.md": ["target.md"] }, backlinks: {} };
  newLinks.resolve(links);
  await second;
  oldFiles.resolve([file("old.md")]); oldLinks.resolve({ outgoing: {}, backlinks: {} });
  await first;
  expect(vault.notes.map(n => n.path)).toEqual(["new.md"]);
  expect(vault.links).toBe(links);
  expect(changed.mock.calls).toEqual([["files"], ["links"]]);
});

function reloadHost() {
  let doc = Text.of(["original"]);
  const host = {
    states: new Map([["a.md", true]]), saveTimers: new Map(), reloads: new Map(),
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

it("keys search facts by term and does not repopulate an invalidated cache", async () => {
  const alpha = deferred<SearchHit[]>(), beta = deferred<SearchHit[]>(), newer = deferred<SearchHit[]>();
  vi.mocked(api.search).mockReturnValueOnce(alpha.promise).mockReturnValueOnce(beta.promise).mockReturnValueOnce(newer.promise);
  const { ws, change } = workspace(), facts = searchFacts(ws);
  const first = facts.facts([parseQuery("alpha beta")])!;
  beta.resolve([hit("beta")]); change();
  const second = facts.facts([parseQuery("alpha")])!;
  newer.resolve([hit("new alpha")]);
  expect((await second).lines("alpha")?.get("a.md")?.[0].text).toBe("new alpha");
  alpha.resolve([hit("old alpha")]);
  const result = await first;
  expect(result.lines("alpha")?.get("a.md")?.[0].text).toBe("old alpha");
  expect(result.lines("beta")?.get("a.md")?.[0].text).toBe("beta");
  expect((await facts.facts([parseQuery("alpha")])!).lines("alpha")?.get("a.md")?.[0].text).toBe("new alpha");
  expect(api.search).toHaveBeenCalledTimes(3);
});

it("does not evict newer tags when an invalidated request fails later", async () => {
  const old = deferred<SearchHit[]>();
  vi.mocked(api.search).mockReturnValueOnce(old.promise).mockResolvedValue([]);
  vi.mocked(api.frontmatter).mockResolvedValue({});
  const { ws, change } = workspace(), tags = vaultTags(ws);
  const first = tags.read().catch(() => null);
  change();
  const second = tags.read();
  await second;
  old.reject(new Error("old request failed")); await first;
  expect(tags.read()).toBe(second);
  expect(api.search).toHaveBeenCalledTimes(10);
});

it("serializes property reads and re-reads a note changed during the first read", async () => {
  const old = deferred<Record<string, string>>();
  vi.mocked(api.frontmatter).mockReturnValueOnce(old.promise).mockResolvedValue({ "a.md": "---\nstatus: new\n---" });
  const { ws } = workspace(), index = propertyIndex(ws);
  const first = index.notes();
  expect(index.notes()).toBe(first);
  (ws as { vault: { files: FileEntry[] } }).vault.files[0].mtime_ms = 2;
  old.resolve({ "a.md": "---\nstatus: old\n---" }); await first;
  expect((await index.notes()).get("a.md")?.props[0].value).toBe("new");
  expect(api.frontmatter).toHaveBeenCalledTimes(2);
});

function navigationHost() {
  const tab = { path: null, back: [], forward: [], pinned: false } as unknown as Tab;
  const group = { active: tab };
  const shown: string[] = [];
  const host = {
    opens: new WeakMap(), activeGroup: group, layout: { groups: () => [group] },
    editors: { load: vi.fn(), viewOf: () => ({ state: { doc: Text.of(["body"]) }, focus: vi.fn() }) },
    target: () => ({ group, tab, layoutChanged: false }), caretIn: () => undefined,
    show: () => { shown.push(tab.path!); },
    openAttachment: () => { host.opens.delete(group); shown.push("canvas"); },
  };
  return { host, shown, open: (path: string) => Workspace.prototype.open.call(host as never, path) };
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
