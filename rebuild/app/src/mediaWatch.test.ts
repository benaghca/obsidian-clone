import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type FileEntry } from "./api";
import { createEditorHost } from "./editorHost";
import { listeners } from "./listeners";
import { Vault } from "./vault";
import { resetBackendRootForTests } from "./vaultRoot";
import type { Workspace } from "./workspace";

vi.mock("./api", () => ({
  api: {
    listFiles: vi.fn(),
    linkIndex: vi.fn(),
    lastVault: vi.fn(),
    onVaultChanged: vi.fn(),
  },
  isTauri: false,
}));

type DiskChange = { kind: "create" | "modify" | "remove" | "rename"; paths: string[] };

function file(path: string, mtime = 1, size = 4): FileEntry {
  return { path, name: path.slice(path.lastIndexOf("/") + 1), is_dir: false, mtime_ms: mtime, ctime_ms: 1, size };
}

function dir(path: string, mtime: number): FileEntry {
  return { path, name: path.slice(path.lastIndexOf("/") + 1), is_dir: true, mtime_ms: mtime, ctime_ms: 0, size: 0 };
}

let files: FileEntry[] = [];
let emit: (change: DiskChange) => void = () => {};
let frames: FrameRequestCallback[] = [];
const realTimeout = setTimeout;

async function settle() {
  while (frames.length) frames.shift()!(0);
  await new Promise((resolve) => realTimeout(resolve, 0));
}

beforeEach(() => {
  vi.resetAllMocks();
  files = [];
  frames = [];
  emit = () => {};
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.mocked(api.onVaultChanged).mockImplementation((handler) => {
    emit = handler;
    return Promise.resolve(() => {});
  });
  vi.mocked(api.lastVault).mockResolvedValue(null);
  vi.mocked(api.listFiles).mockImplementation(async () => files.map((entry) => ({ ...entry })));
  vi.mocked(api.linkIndex).mockResolvedValue({ outgoing: {} });
});

afterEach(() => {
  resetBackendRootForTests();
  vi.unstubAllGlobals();
});

async function openHost() {
  const changes = listeners<["files" | "links"]>();
  const vault = new Vault((change) => changes.emit(change), async () => {});
  await vault.open();
  const host = createEditorHost({ vault, on: changes.on, recent: [] } as unknown as Workspace);
  return { vault, host };
}

it("reloads a watched recording once when one batch recreates it", async () => {
  files = [file("clip.mp3", 1, 4)];
  const { host } = await openHost();
  let hits = 0;
  host.embeds.watch("clip.mp3", () => { hits += 1; });

  files = [file("clip.mp3", 2, 8)];
  emit({ kind: "remove", paths: ["clip.mp3"] });
  emit({ kind: "create", paths: ["clip.mp3"] });
  await settle();
  expect(hits).toBe(1);

  files = [file("clip.mp3", 3, 9)];
  emit({ kind: "create", paths: ["clip.mp3"] });
  await settle();
  expect(hits).toBe(2);

  // Same mtime and size still arrives on the media-path signal, once.
  hits = 0;
  emit({ kind: "remove", paths: ["clip.mp3"] });
  emit({ kind: "create", paths: ["clip.mp3"] });
  await settle();
  expect(hits).toBe(1);

  // A modify in a batch that also refreshes the list is one reload, not the signature plus the touch.
  hits = 0;
  files = [file("clip.mp3", 4, 11)];
  emit({ kind: "modify", paths: ["clip.mp3"] });
  emit({ kind: "create", paths: ["Note.md"] });
  await settle();
  expect(hits).toBe(1);
});

it("does not reload a recording again when a later batch only refreshes the file list", async () => {
  files = [file("clip.mp3", 1, 4)];
  const { host } = await openHost();
  let hits = 0;
  host.embeds.watch("clip.mp3", () => { hits += 1; });

  files = [file("clip.mp3", 2, 8)];
  emit({ kind: "modify", paths: ["clip.mp3"] });
  await settle();
  expect(hits).toBe(1);

  files = [file("clip.mp3", 2, 8), file("Note.md", 1, 1)];
  emit({ kind: "create", paths: ["Note.md"] });
  await settle();
  expect(hits).toBe(1);

  files = [file("clip.mp3", 3, 12), file("Note.md", 1, 1)];
  emit({ kind: "modify", paths: ["clip.mp3"] });
  await settle();
  expect(hits).toBe(2);

  files = [file("Away/clip.mp3", 3, 12), file("Note.md", 1, 1)];
  emit({ kind: "rename", paths: ["Dir", "Away"] });
  await settle();
  expect(hits).toBe(3);
});

it("reloads when a later batch replaces the folder after a modify", async () => {
  files = [dir("Dir", 10), file("Dir/clip.mp3", 1, 4)];
  const { host } = await openHost();
  let hits = 0;
  host.embeds.watch("Dir/clip.mp3", () => { hits += 1; });

  files = [dir("Dir", 10), file("Dir/clip.mp3", 2, 8)];
  emit({ kind: "modify", paths: ["Dir/clip.mp3"] });
  await settle();
  expect(hits).toBe(1);

  files = [dir("Dir", 10), file("Dir/clip.mp3", 2, 8), file("Note.md", 1, 1)];
  emit({ kind: "create", paths: ["Note.md"] });
  await settle();
  expect(hits).toBe(1);

  files = [dir("Dir", 50), file("Dir/clip.mp3", 9, 20)];
  emit({ kind: "remove", paths: ["Dir"] });
  emit({ kind: "rename", paths: ["Other", "Dir"] });
  await settle();
  expect(hits).toBe(2);
});

it("does not reload when a note is created in the same folder after a modify", async () => {
  files = [dir("Dir", 10), file("Dir/clip.mp3", 1, 4)];
  const { host } = await openHost();
  let hits = 0;
  host.embeds.watch("Dir/clip.mp3", () => { hits += 1; });

  files = [dir("Dir", 10), file("Dir/clip.mp3", 2, 8)];
  emit({ kind: "modify", paths: ["Dir/clip.mp3"] });
  await settle();
  expect(hits).toBe(1);

  files = [dir("Dir", 99), file("Dir/clip.mp3", 2, 8), file("Dir/Note.md", 1, 1)];
  emit({ kind: "create", paths: ["Dir/Note.md"] });
  await settle();
  expect(hits).toBe(1);
});

it("reloads when a replaced folder keeps the same mtime and size", async () => {
  files = [dir("Dir", 10), file("Dir/clip.mp3", 1, 4)];
  const { host } = await openHost();
  let hits = 0;
  host.embeds.watch("Dir/clip.mp3", () => { hits += 1; });

  files = [dir("Dir", 10), file("Dir/clip.mp3", 2, 8)];
  emit({ kind: "modify", paths: ["Dir/clip.mp3"] });
  await settle();
  expect(hits).toBe(1);

  files = [dir("Dir", 10), file("Dir/clip.mp3", 9, 20)];
  emit({ kind: "remove", paths: ["Dir"] });
  emit({ kind: "rename", paths: ["Other", "Dir"] });
  await settle();
  expect(hits).toBe(2);
});

it("reloads when a replaced folder keeps the media stamp as well", async () => {
  files = [dir("Dir", 10), file("Dir/clip.mp3", 1, 4)];
  const { host } = await openHost();
  let hits = 0;
  host.embeds.watch("Dir/clip.mp3", () => { hits += 1; });

  files = [dir("Dir", 10), file("Dir/clip.mp3", 1, 4)];
  emit({ kind: "remove", paths: ["Dir"] });
  emit({ kind: "rename", paths: ["Other", "Dir"] });
  await settle();
  expect(hits).toBe(1);

  // Naming the file in that same kind of batch still reloads once.
  emit({ kind: "remove", paths: ["Dir"] });
  emit({ kind: "create", paths: ["Dir/clip.mp3"] });
  await settle();
  expect(hits).toBe(2);
});

it("reloads once when a local edit discards the list read for a replaced folder", async () => {
  files = [dir("Dir", 10), file("Dir/clip.mp3", 1, 4)];
  const { vault, host } = await openHost();
  let hits = 0;
  host.embeds.watch("Dir/clip.mp3", () => { hits += 1; });
  files = [dir("Dir", 10), file("Dir/clip.mp3", 2, 8)];
  emit({ kind: "modify", paths: ["Dir/clip.mp3"] });
  await settle();
  expect(hits).toBe(1);

  const hung: Array<(listed: FileEntry[]) => void> = [];
  vi.mocked(api.listFiles).mockImplementation(
    () => new Promise((resolve) => hung.push((listed) => resolve(listed))),
  );
  files = [dir("Dir", 10), file("Dir/clip.mp3", 9, 20)];
  emit({ kind: "remove", paths: ["Dir"] });
  emit({ kind: "rename", paths: ["Other", "Dir"] });
  await settle();
  expect(hung).toHaveLength(1);
  expect(vault.adoptAdded(file("Local.md", 3, 3))).toBe(true);

  const listed = () => files.map((entry) => ({ ...entry }));
  hung.shift()!(listed());
  await new Promise((resolve) => realTimeout(resolve, 0));
  expect(hung).toHaveLength(1);
  hung.shift()!(listed());
  await settle();
  expect(hits).toBe(2);
});

it("reloads once when a discarded read's batch also names the watched recording", async () => {
  files = [dir("Dir", 10), file("Dir/clip.mp3", 1, 4)];
  const { vault, host } = await openHost();
  let hits = 0;
  host.embeds.watch("Dir/clip.mp3", () => { hits += 1; });
  files = [dir("Dir", 10), file("Dir/clip.mp3", 2, 8)];
  emit({ kind: "modify", paths: ["Dir/clip.mp3"] });
  await settle();
  expect(hits).toBe(1);

  const hung: Array<(listed: FileEntry[]) => void> = [];
  vi.mocked(api.listFiles).mockImplementation(
    () => new Promise((resolve) => hung.push((listed) => resolve(listed))),
  );
  files = [dir("Dir", 10), file("Dir/clip.mp3", 9, 20)];
  emit({ kind: "remove", paths: ["Dir"] });
  emit({ kind: "rename", paths: ["Other", "Dir"] });
  emit({ kind: "create", paths: ["Dir/clip.mp3"] });
  await settle();
  expect(hung).toHaveLength(1);
  expect(vault.adoptAdded(file("Local.md", 3, 3))).toBe(true);

  const listed = () => files.map((entry) => ({ ...entry }));
  hung.shift()!(listed());
  await new Promise((resolve) => realTimeout(resolve, 0));
  expect(hung).toHaveLength(1);
  expect(hits).toBe(2);
  hung.shift()!(listed());
  await settle();
  expect(hits).toBe(2);
});

it("reloads once when a discarded read's ancestor rename also modifies the recording", async () => {
  files = [dir("Dir", 10), file("Dir/clip.mp3", 1, 4)];
  const { vault, host } = await openHost();
  let hits = 0;
  host.embeds.watch("Dir/clip.mp3", () => { hits += 1; });
  files = [dir("Dir", 10), file("Dir/clip.mp3", 2, 8)];
  emit({ kind: "modify", paths: ["Dir/clip.mp3"] });
  await settle();
  expect(hits).toBe(1);

  const hung: Array<(listed: FileEntry[]) => void> = [];
  vi.mocked(api.listFiles).mockImplementation(
    () => new Promise((resolve) => hung.push((listed) => resolve(listed))),
  );
  files = [dir("Dir", 10), file("Dir/clip.mp3", 9, 20)];
  emit({ kind: "rename", paths: ["Other", "Dir"] });
  emit({ kind: "modify", paths: ["Dir/clip.mp3"] });
  await settle();
  expect(hung).toHaveLength(1);
  expect(vault.adoptAdded(file("Local.md", 3, 3))).toBe(true);

  const listed = () => files.map((entry) => ({ ...entry }));
  hung.shift()!(listed());
  await new Promise((resolve) => realTimeout(resolve, 0));
  expect(hung).toHaveLength(1);
  expect(hits).toBe(2);
  hung.shift()!(listed());
  await settle();
  expect(hits).toBe(2);
});

it("matches a watched recording to its folder, not a sibling or a shared prefix", async () => {
  files = [
    dir("Dir", 10),
    dir("Directory", 10),
    dir("Dir/sub", 10),
    file("Dir/clip.mp3", 1, 4),
    file("Directory/clip.mp3", 1, 4),
    file("Dir/sub/clip.mp3", 1, 4),
  ];
  const { host } = await openHost();
  let dirHits = 0;
  let nested = 0;
  let lookalike = 0;
  host.embeds.watch("Dir/clip.mp3", () => { dirHits += 1; });
  host.embeds.watch("Dir/sub/clip.mp3", () => { nested += 1; });
  host.embeds.watch("Directory/clip.mp3", () => { lookalike += 1; });

  files = [...files, file("Dir/Note.md", 1, 1)];
  emit({ kind: "create", paths: ["Dir/Note.md"] });
  await settle();
  expect(dirHits).toBe(0);
  expect(nested).toBe(0);
  expect(lookalike).toBe(0);

  emit({ kind: "remove", paths: ["Dir"] });
  emit({ kind: "rename", paths: ["Other", "Dir"] });
  await settle();
  expect(dirHits).toBe(1);
  expect(nested).toBe(1);
  expect(lookalike).toBe(0);

  emit({ kind: "remove", paths: ["Dir/sub"] });
  await settle();
  expect(dirHits).toBe(1);
  expect(nested).toBe(2);
  expect(lookalike).toBe(0);
});

it("does not remember a modify for a recording nobody is watching", async () => {
  files = [file("clip.mp3", 1, 4)];
  const { host } = await openHost();
  files = [file("clip.mp3", 2, 8)];
  emit({ kind: "modify", paths: ["clip.mp3"] });
  await settle();

  let hits = 0;
  host.embeds.watch("clip.mp3", () => { hits += 1; });
  files = [file("clip.mp3", 2, 8), file("Note.md", 1, 1)];
  emit({ kind: "create", paths: ["Note.md"] });
  await settle();
  expect(hits).toBe(1);
});

it("reloads a watched file once when a folder rename drops it from the list", async () => {
  files = [file("Dir/clip.mp3", 1, 4)];
  const { host } = await openHost();
  let hits = 0;
  host.embeds.watch("Dir/clip.mp3", () => { hits += 1; });
  files = [file("Away/clip.mp3", 1, 4)];
  emit({ kind: "rename", paths: ["Dir", "Away"] });
  await settle();
  expect(hits).toBe(1);
});

it("stops scanning a media path when its last watcher unsubscribes", async () => {
  files = [file("clip.mp3", 1, 4), file("keep.mp3", 1, 4)];
  const { vault, host } = await openHost();
  let clip = 0;
  let keep = 0;
  let first = 0;
  const stopClip = host.embeds.watch("clip.mp3", () => { clip += 1; });
  const stopFirst = host.embeds.watch("keep.mp3", () => { first += 1; });
  host.embeds.watch("keep.mp3", () => { keep += 1; });
  stopFirst();
  stopFirst();

  files = [file("clip.mp3", 2, 8), file("keep.mp3", 2, 8)];
  emit({ kind: "create", paths: ["clip.mp3", "keep.mp3"] });
  await settle();
  expect(clip).toBe(1);
  expect(first).toBe(0);
  expect(keep).toBe(1);

  stopClip();
  const entry = vi.spyOn(vault, "entry");
  files = [file("clip.mp3", 3, 9), file("keep.mp3", 3, 9)];
  emit({ kind: "create", paths: ["Note.md"] });
  await settle();
  const scanned = entry.mock.calls.map((call) => call[0]);
  expect(scanned).not.toContain("clip.mp3");
  expect(scanned).toContain("keep.mp3");
  expect(clip).toBe(1);

  let again = 0;
  host.embeds.watch("clip.mp3", () => { again += 1; });
  emit({ kind: "create", paths: ["Other.md"] });
  await settle();
  expect(again).toBe(0);
});
