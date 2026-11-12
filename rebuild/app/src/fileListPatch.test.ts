import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type FileEntry } from "./api";
import { editingEmbed } from "./editor/embeds";
import { type EditorHost, editorHost } from "./editor/host";
import { filesChanged, LivePreview } from "./editor/livePreview";
import { readingMode } from "./editor/render";
import { markdownSyntax } from "./editor/syntax";
import { createNote } from "./fileOps";
import { resolveLink } from "./links/internal";
import { addEntry, docNeedsFileRefresh, listTokens, pathCmp } from "./listPatch";
import { isUnder, movedPath } from "./paths";
import { installPathBarrier } from "./pathBarrier";
import { sealWrites, unsealWrites } from "./saveSeal";
import { Vault } from "./vault";
import { resetBackendRootForTests, setBackendRoot, setPageVault } from "./vaultRoot";
import { localSaveBus } from "./vaultSwitch";
import type { Workspace } from "./workspace";

vi.mock("./api", () => ({
  api: {
    createNote: vi.fn(),
    listFiles: vi.fn(),
    linkIndex: vi.fn(),
    createFolder: vi.fn(),
  },
  isTauri: false,
}));

function entry(path: string, isDir = false): FileEntry {
  const slash = path.lastIndexOf("/");
  const base = slash < 0 ? path : path.slice(slash + 1);
  const name = !isDir && base.length > 3 && base.slice(-3).toLowerCase() === ".md" ? base.slice(0, -3) : base;
  return { path, name, is_dir: isDir, mtime_ms: 5, ctime_ms: 4, size: 3 };
}

function vaultWith(files: FileEntry[]): Vault {
  const vault = new Vault(() => {}, async () => {});
  vault.files = files;
  return vault;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listFiles).mockResolvedValue([]);
  vi.mocked(api.linkIndex).mockResolvedValue({ outgoing: {} });
  vi.stubGlobal("window", {
    setTimeout: () => 0,
    clearTimeout() {},
    addEventListener() {},
    removeEventListener() {},
  });
});

afterEach(() => {
  unsealWrites();
  resetBackendRootForTests();
  vi.unstubAllGlobals();
});

it("adds a created note without reading the whole file list", async () => {
  const vault = vaultWith([entry("A.md"), entry("C.md")]);
  const before = vault.files;
  vi.mocked(api.createNote).mockResolvedValue(entry("B.md"));
  const made = await createNote({ vault } as Workspace, "B.md", "");
  expect(made.path).toBe("B.md");
  expect(api.listFiles).not.toHaveBeenCalled();
  expect(vault.files).not.toBe(before);
  expect(vault.files.map((file) => file.path)).toEqual(["A.md", "B.md", "C.md"]);
  expect(vault.entry("B.md")).toMatchObject({ name: "B", size: 3 });
  expect(vault.entry("B.md")!.mtime_ms).toBeGreaterThan(5);
  expect(vault.notes.map((note) => note.path)).toEqual(["A.md", "B.md", "C.md"]);
  expect(vault.linkExists("B", null)).toBe(true);
  // A one-letter name is too short to decide which panes mention it.
  expect(vault.fileTouch()).toBeNull();
});

it("leaves the list untouched when create fails", async () => {
  const vault = vaultWith([entry("A.md")]);
  const before = vault.files;
  vi.mocked(api.createNote).mockRejectedValue(new Error("already exists"));
  await expect(createNote({ vault } as Workspace, "B.md", "")).rejects.toThrow("already exists");
  expect(vault.files).toBe(before);
  expect(vault.entry("B.md")).toBeUndefined();
  expect(api.listFiles).not.toHaveBeenCalled();
});

it("reads the list when a created note's parent folder is not listed yet", async () => {
  const listed = [entry("A.md")];
  vi.mocked(api.listFiles).mockResolvedValue(listed);
  vi.mocked(api.createNote).mockResolvedValue(entry("Box/B.md"));
  const vault = vaultWith([entry("A.md")]);
  await createNote({ vault } as Workspace, "Box/B.md", "");
  expect(api.listFiles).toHaveBeenCalledOnce();
  expect(vault.files).toBe(listed);
  expect(vault.entry("Box/B.md")).toBeUndefined();
});

it("does not insert a file while this page does not own the disk", () => {
  const vault = vaultWith([entry("A.md")]);
  sealWrites();
  expect(vault.adoptAdded(entry("B.md"))).toBe(false);
  expect(vault.entry("B.md")).toBeUndefined();
  unsealWrites();
  setPageVault("/old");
  setBackendRoot("/new");
  expect(vault.adoptAdded(entry("B.md"))).toBe(false);
  expect(vault.files.map((file) => file.path)).toEqual(["A.md"]);
});

it("renames a folder's children without reading the list, and refuses a missing parent", () => {
  const vault = vaultWith([
    entry("A", true),
    entry("A/N.md"),
    entry("A/Plan.canvas"),
    entry("A/Sub", true),
    entry("A/Sub/X.md"),
    entry("Z.md"),
  ]);
  expect(vault.adoptMapped((path) => movedPath(path, "A", "B"))).toBe(true);
  expect(api.listFiles).not.toHaveBeenCalled();
  expect(vault.files.map((file) => file.path)).toEqual(["B", "B/N.md", "B/Plan.canvas", "B/Sub", "B/Sub/X.md", "Z.md"]);
  expect(vault.entry("B/N.md")).toMatchObject({ name: "N", mtime_ms: 5, size: 3 });
  expect(vault.entry("B/Plan.canvas")?.name).toBe("Plan.canvas");
  expect(vault.entry("B")?.is_dir).toBe(true);
  expect(vault.entry("A/N.md")).toBeUndefined();
  const flat = vaultWith([entry("A.md")]);
  expect(flat.adoptMapped((path) => movedPath(path, "A.md", "Missing/A.md"))).toBe(false);
  expect(flat.files.map((file) => file.path)).toEqual(["A.md"]);
});

it("drops a deleted folder and everything inside it", () => {
  const vault = vaultWith([entry("A", true), entry("A/N.md"), entry("Z.md")]);
  const before = vault.files;
  expect(vault.dropPaths((path) => isUnder(path, "A"))).toBe(true);
  expect(vault.files).not.toBe(before);
  expect(vault.files.map((file) => file.path)).toEqual(["Z.md"]);
  expect(api.listFiles).not.toHaveBeenCalled();
});

it("confirms a local create with a fresh read when an older list omits it", async () => {
  const vault = vaultWith([entry("A.md"), entry("C.md")]);
  let release: (files: FileEntry[]) => void = () => {};
  let calls = 0;
  vi.mocked(api.listFiles).mockImplementation(() => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { release = resolve; });
    return Promise.resolve([entry("A.md"), entry("B.md"), entry("C.md")]);
  });
  const pending = vault.refreshFiles();
  expect(vault.adoptAdded(entry("B.md"))).toBe(true);
  release([entry("A.md"), entry("C.md")]);
  await pending;
  await vi.waitFor(() => expect(vault.entry("B.md")).toBeTruthy());
  expect(vault.files.map((file) => file.path)).toEqual(["A.md", "B.md", "C.md"]);
  expect(calls).toBe(2);
});

it("lets an outside change in an older snapshot win over a local create", async () => {
  const vault = vaultWith([entry("A.md"), entry("C.md")]);
  let release: (files: FileEntry[]) => void = () => {};
  let calls = 0;
  const disk = [entry("A.md"), entry("C.md"), entry("Outside.md")];
  vi.mocked(api.listFiles).mockImplementation(() => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { release = resolve; });
    return Promise.resolve(disk);
  });
  const pending = vault.refreshFiles();
  expect(vault.adoptAdded(entry("B.md"))).toBe(true);
  expect(vault.entry("B.md")).toBeTruthy();
  release([entry("A.md"), entry("C.md"), entry("Outside.md")]);
  await pending;
  await vi.waitFor(() => expect(vault.entry("Outside.md")).toBeTruthy());
  expect(vault.entry("B.md")).toBeUndefined();
  expect(vault.files).toBe(disk);
  expect(vault.notes.map((note) => note.path)).toEqual(["A.md", "C.md", "Outside.md"]);
});

it("reads a third time when another edit lands during the confirmation", async () => {
  const vault = vaultWith([entry("Keep.md")]);
  let calls = 0;
  let releaseR1: (files: FileEntry[]) => void = () => {};
  let releaseR2: (files: FileEntry[]) => void = () => {};
  const disk = [entry("Keep.md"), entry("Later.md"), entry("Outside.md")];
  vi.mocked(api.listFiles).mockImplementation(() => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { releaseR1 = resolve; });
    if (calls === 2) return new Promise((resolve) => { releaseR2 = resolve; });
    return Promise.resolve(disk);
  });
  const pending = vault.refreshFiles();
  expect(vault.adoptAdded(entry("LocalA.md"))).toBe(true);
  releaseR1([entry("Keep.md"), entry("Outside.md")]);
  await vi.waitFor(() => expect(calls).toBe(2));
  expect(vault.adoptAdded(entry("LocalB.md"))).toBe(true);
  expect(vault.entry("Outside.md")).toBeUndefined();
  releaseR2([entry("Keep.md"), entry("Outside.md")]);
  await pending;
  await vi.waitFor(() => expect(vault.files).toBe(disk));
  expect(calls).toBe(3);
  expect(vault.entry("LocalA.md")).toBeUndefined();
  expect(vault.entry("LocalB.md")).toBeUndefined();
  expect(vault.entry("Outside.md")?.path).toBe("Outside.md");
  expect(vault.notes.map((note) => note.path)).toEqual(["Keep.md", "Later.md", "Outside.md"]);
});

it("keeps a recreated file when a peer delete finishes after the watcher", async () => {
  const vault = vaultWith([entry("Gone.md"), entry("Keep.md")]);
  // Backend order. The watcher installs this array as it stands.
  const disk = [{ ...entry("Gone.md"), mtime_ms: 77, size: 9 }, entry("Keep.md")];
  vi.mocked(api.listFiles).mockResolvedValue(disk);
  const bus = localSaveBus();
  let settled = Promise.resolve();
  await installPathBarrier({
    hold() {},
    release() {},
    flush: async () => true,
    handoff: async () => true,
    retarget() {},
    discard() {},
    epoch: () => vault.fileEpoch(),
    removed(under, epoch) {
      settled = (async () => {
        if (!vault.dropPaths(under, epoch)) await vault.refreshFiles();
      })();
      return settled;
    },
  }, { bus, self: "peer" });
  await bus.emit("grove-path-hold", { id: "d1", path: "Gone.md", from: "main" });
  await vault.refreshFiles();
  expect(vault.fileEpoch()).toBe(1);
  expect(vault.entry("Gone.md")?.mtime_ms).toBe(77);
  await bus.emit("grove-path-done", { id: "d1", from: "main", ok: true });
  await settled;
  expect(vault.entry("Gone.md")).toMatchObject({ mtime_ms: 77, size: 9 });
  expect(vault.notes.map((note) => note.path)).toContain("Gone.md");
  expect(vault.includedNotes().map((note) => note.path)).toContain("Gone.md");
  expect(vault.files.map((file) => file.path)).toEqual(["Gone.md", "Keep.md"]);
});

it("lets a list read that starts after the create replace the patched entry", async () => {
  const vault = vaultWith([entry("A.md"), entry("C.md")]);
  expect(vault.adoptAdded(entry("B.md"))).toBe(true);
  const disk = [entry("A.md"), { ...entry("B.md"), mtime_ms: 11 }, entry("C.md")];
  vi.mocked(api.listFiles).mockResolvedValue(disk);
  await vault.refreshFiles();
  expect(vault.files).toBe(disk);
  expect(vault.entry("B.md")?.mtime_ms).toBe(11);
  expect(vault.fileTouch()).toEqual([]);
});

it("does not install a stale list after the page stops owning the disk", async () => {
  const vault = vaultWith([entry("A.md")]);
  let release: (files: FileEntry[]) => void = () => {};
  vi.mocked(api.listFiles).mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const pending = vault.refreshFiles();
  expect(vault.adoptAdded(entry("B.md"))).toBe(true);
  const patched = vault.files;
  sealWrites();
  release([]);
  await pending;
  expect(vault.files).toBe(patched);
  expect(vault.entry("B.md")?.path).toBe("B.md");
});

it("orders paths the way the backend file map does, and keeps a partial-path winner", () => {
  const y = "\uFF39.md";
  const z = "\uFF3A.md";
  const emoji = "\u{1F600}.md";
  expect(pathCmp(y, z)).toBeLessThan(0);
  expect(pathCmp(z, emoji)).toBeLessThan(0);
  expect(addEntry([entry(z), entry(emoji)], entry(y))!.map((file) => file.path)).toEqual([y, z, emoji]);
  const zNote = "\uFF3A/Shared/Note.md";
  const eNote = "\u{1F600}/Shared/Note.md";
  const vault = vaultWith([
    entry("Other.md"),
    entry("\uFF3A", true),
    entry("\uFF3A/Shared", true),
    entry(zNote),
    entry("\u{1F600}", true),
    entry("\u{1F600}/Shared", true),
    entry(eNote),
  ]);
  // The files setter stores the list. Notes follow that order, as a disk read would.
  vault.notes = vault.files.filter((file) => !file.is_dir).map((file) => ({ name: file.name, path: file.path }));
  expect(resolveLink("Shared/Note", null, vault.notes)).toBe(zNote);
  expect(vault.adoptMapped((path) => movedPath(path, "Other.md", "Later.md"))).toBe(true);
  expect(api.listFiles).not.toHaveBeenCalled();
  expect(resolveLink("Shared/Note", null, vault.notes)).toBe(zNote);
  expect(vault.entry("Later.md")?.name).toBe("Later");
});

it("redraws a nested wikilink, an encoded link, and an embed on create, delete, and rename", () => {
  const nested = listTokens([{ path: "A.md" }], [{ path: "A.md" }, { path: "Projects/Fresh name.md" }]);
  expect(nested).toEqual(expect.arrayContaining(["fresh name", "fresh%20name", "projects/fresh name"]));
  expect(docNeedsFileRefresh("see [[Fresh name]]", nested)).toBe(true);
  expect(docNeedsFileRefresh("see [n](Projects/Fresh%20name.md)", nested)).toBe(true);
  expect(docNeedsFileRefresh("![[Daily]]\n\nno name here", nested)).toBe(true);
  expect(docNeedsFileRefresh("no mention", nested)).toBe(false);
  const encoded = listTokens([{ path: "A.md" }], [{ path: "A.md" }, { path: "Fresh%20name.md" }]);
  expect(docNeedsFileRefresh("[[Fresh name]]", encoded)).toBe(true);
  expect(docNeedsFileRefresh("[n](Fresh%20name.md)", encoded)).toBe(true);
  const removed = listTokens([{ path: "A.md" }, { path: "Projects/Fresh name.md" }], [{ path: "A.md" }]);
  expect(docNeedsFileRefresh("[[Fresh name]]", removed)).toBe(true);
  expect(docNeedsFileRefresh("![[pic.png]]", removed)).toBe(true);
  const renamed = listTokens([{ path: "Projects/Fresh name.md" }], [{ path: "Projects/Other name.md" }]);
  expect(docNeedsFileRefresh("[[Fresh name]]", renamed)).toBe(true);
  expect(docNeedsFileRefresh("[a](Projects/Other%20name.md)", renamed)).toBe(true);
  expect(docNeedsFileRefresh("plain prose", renamed)).toBe(false);
});

it("redraws a percent-encoded non-ASCII link, including a mixed encoding, on create, delete, and rename", () => {
  const cafe = "Caf\u00e9.md";
  const canonical = "[n](Caf%C3%A9.md)";
  const mixed = "[n](%43af%C3%A9.md)";
  const added = listTokens([{ path: "A.md" }], [{ path: "A.md" }, { path: cafe }]);
  expect(docNeedsFileRefresh(canonical, added)).toBe(true);
  expect(docNeedsFileRefresh(mixed, added)).toBe(true);
  expect(docNeedsFileRefresh("[n](Other%20note.md)", added)).toBe(false);
  const removed = listTokens([{ path: "A.md" }, { path: cafe }], [{ path: "A.md" }]);
  expect(docNeedsFileRefresh(canonical, removed)).toBe(true);
  expect(docNeedsFileRefresh(mixed, removed)).toBe(true);
  const renamed = listTokens([{ path: cafe }], [{ path: "Tea.md" }]);
  expect(docNeedsFileRefresh(canonical, renamed)).toBe(true);
  expect(docNeedsFileRefresh(mixed, renamed)).toBe(true);
  expect(docNeedsFileRefresh("plain prose", renamed)).toBe(false);

  const vault = vaultWith([entry("A.md")]);
  const doc = `${canonical}\n${mixed}`;
  const view = {
    state: EditorState.create({
      doc,
      extensions: [markdownSyntax, editingEmbed, readingMode.of(true), editorHost.of({
        linkExists: (target: string) => vault.linkExists(target, null),
      } as unknown as EditorHost)],
    }),
    hasFocus: true,
    get visibleRanges() {
      return [{ from: 0, to: this.state.doc.length }];
    },
    dispatch(spec: TransactionSpec) {
      const tr = this.state.update(spec);
      const startState = this.state;
      this.state = tr.state;
      lp.update({
        view,
        state: tr.state,
        startState,
        transactions: [tr],
        changes: tr.changes,
        docChanged: tr.docChanged,
        selectionSet: !!tr.selection,
        focusChanged: false,
        viewportChanged: false,
      } as unknown as ViewUpdate);
    },
  };
  const lp = new LivePreview(view as unknown as EditorView);
  const unresolved = () => {
    let count = 0;
    lp.decorations.between(0, doc.length, (_from, _to, deco) => {
      if (typeof deco.spec.class === "string" && deco.spec.class.includes("is-unresolved")) count += 1;
    });
    return count;
  };
  const follow = () => {
    const tokens = vault.fileTouch();
    expect(docNeedsFileRefresh(canonical, tokens)).toBe(true);
    expect(docNeedsFileRefresh(mixed, tokens)).toBe(true);
    if (docNeedsFileRefresh(doc, tokens)) view.dispatch({ effects: filesChanged.of(null) });
  };
  expect(unresolved()).toBe(2);
  expect(vault.adoptAdded(entry(cafe))).toBe(true);
  follow();
  expect(unresolved()).toBe(0);
  expect(vault.dropPaths((path) => path === cafe)).toBe(true);
  follow();
  expect(unresolved()).toBe(2);
  expect(vault.adoptAdded(entry(cafe))).toBe(true);
  follow();
  expect(unresolved()).toBe(0);
  expect(vault.adoptMapped((path) => movedPath(path, cafe, "Tea.md"))).toBe(true);
  follow();
  expect(unresolved()).toBe(2);
});

it("drops the unresolved mark and the missing embed once the file list catches up", () => {
  let present = false;
  const host = {
    linkExists: (target: string) => present && /fresh|daily|pic\.png/i.test(target),
    embeds: {
      resolve: (target: string) => {
        if (!present) return null;
        if (target === "Daily") return "Daily.md";
        if (target === "pic.png") return "pic.png";
        return null;
      },
    },
  };
  const doc = "see [[Fresh name]]\n\n[n](Projects/Fresh%20name.md)\n\n![[Daily]]\n\n![[pic.png]]";
  const view = {
    state: EditorState.create({
      doc,
      extensions: [markdownSyntax, editingEmbed, readingMode.of(true), editorHost.of(host as unknown as EditorHost)],
    }),
    hasFocus: true,
    get visibleRanges() {
      return [{ from: 0, to: this.state.doc.length }];
    },
    dispatch(spec: TransactionSpec) {
      const tr = this.state.update(spec);
      const startState = this.state;
      this.state = tr.state;
      lp.update({
        view,
        state: tr.state,
        startState,
        transactions: [tr],
        changes: tr.changes,
        docChanged: tr.docChanged,
        selectionSet: !!tr.selection,
        focusChanged: false,
        viewportChanged: false,
      } as unknown as ViewUpdate);
    },
  };
  const lp = new LivePreview(view as unknown as EditorView);
  const snap = () => {
    const classes: string[] = [];
    const widgets: { kind: string; path: string | null }[] = [];
    lp.decorations.between(0, doc.length, (_from, _to, deco) => {
      if (typeof deco.spec.class === "string") classes.push(deco.spec.class);
      const widget = deco.spec.widget as { path?: string | null; constructor: { name: string } } | undefined;
      if (widget && "path" in widget) widgets.push({ kind: widget.constructor.name, path: widget.path ?? null });
    });
    return { classes, widgets };
  };
  const before = snap();
  expect(before.classes.some((cls) => cls.includes("cm-wikilink") && cls.includes("is-unresolved"))).toBe(true);
  expect(before.classes.some((cls) => cls.includes("cm-rendered-link") && cls.includes("is-unresolved"))).toBe(true);
  expect(before.widgets).toEqual(expect.arrayContaining([
    { kind: "NoteEmbedWidget", path: null },
    { kind: "ImageWidget", path: null },
  ]));
  present = true;
  view.dispatch({ effects: filesChanged.of(null) });
  const after = snap();
  expect(after.classes.some((cls) => cls.includes("is-unresolved"))).toBe(false);
  expect(after.widgets).toEqual(expect.arrayContaining([
    { kind: "NoteEmbedWidget", path: "Daily.md" },
    { kind: "ImageWidget", path: "pic.png" },
  ]));
});

it("names only the paths a file-list change added or removed", () => {
  expect(listTokens([], [{ path: "A.md" }])).toBeNull();
  expect(listTokens([{ path: "A.md" }], [{ path: "A.md" }])).toEqual([]);
  expect(listTokens([{ path: "A.md" }], [{ path: "A.md" }, { path: "B.md" }])).toBeNull();
  expect(listTokens([{ path: "A.md" }], [{ path: "A.md" }, { path: "Fresh name.md" }])).toEqual(
    expect.arrayContaining(["fresh name.md", "fresh name"]),
  );
  expect(docNeedsFileRefresh("see [[Fresh name]] here", ["fresh name"])).toBe(true);
  expect(docNeedsFileRefresh("no link to it", ["fresh name"])).toBe(false);
  expect(docNeedsFileRefresh("no link to it", null)).toBe(true);
  expect(docNeedsFileRefresh("no link to it", [])).toBe(false);
  expect(docNeedsFileRefresh("no link to it", ["ab"])).toBe(true);
});

it("patches a 5000-file list without a full read", () => {
  const files = Array.from({ length: 5000 }, (_, i) => entry(`N${String(i).padStart(4, "0")}.md`));
  const vault = vaultWith(files);
  const started = performance.now();
  expect(vault.adoptAdded(entry("Untitled.md"))).toBe(true);
  const ms = performance.now() - started;
  console.log(`FILE_LIST_PATCH_MS ${ms.toFixed(2)}`);
  expect(ms).toBeLessThan(50);
  expect(api.listFiles).not.toHaveBeenCalled();
  expect(vault.entry("Untitled.md")?.name).toBe("Untitled");
  expect(vault.files).toHaveLength(5001);
});
