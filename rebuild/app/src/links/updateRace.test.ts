// Link updates that yield while the user types, saves, or moves things again.
// The real rename (fileOps.renameFile → relocate) and the real updateNoteText
// run against an in-memory disk; loaded notes are CodeMirror states.
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "../api";
import { fileSettings, renameFile } from "../fileOps";
import { isUnder, noteName } from "../paths";
import type { Workspace } from "../workspace";
import { updateLinks } from "./update";

const io = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  /** Called after each write to disk, with the write's number. */
  onWrite: (_n: number) => {},
  /** Awaited between taking a file's text and replying, so a read can go stale. */
  beforeReply: async (_path: string) => {},
  writes: 0,
}));
vi.mock("../api", () => ({
  api: {
    readNote: async (path: string) => {
      const text = io.disk.get(path);
      if (text === undefined) throw new Error(`no such file: ${path}`);
      await io.beforeReply(path);
      return text;
    },
    writeNote: async (path: string, content: string) => {
      io.disk.set(path, content);
      io.onWrite(++io.writes);
    },
    renamePath: async (from: string, to: string) => {
      for (const [path, text] of [...io.disk]) {
        if (path !== from && !path.startsWith(`${from}/`)) continue;
        io.disk.delete(path);
        io.disk.set(to + path.slice(from.length), text);
      }
    },
    // A superset is allowed: every note.
    linkSources: async () => [...io.disk.keys()].filter((p) => p.endsWith(".md")).sort(),
  },
}));

const style = { format: "absolute", wikilinks: true } as const;
const states = new Map<string, EditorState>();
const moveFns = new Set<(swap: (path: string) => string) => void>();
const modFns = new Set<(path: string) => void>();
let jobs: Promise<number>[] = [];
const on = <T,>(set: Set<T>, fn: T) => (set.add(fn), () => void set.delete(fn));

const ws = {
  vault: {
    get files() { return [...io.disk.keys()].sort().map((path) => ({ path, name: noteName(path), is_dir: false })); },
    get notes() { return [...io.disk.keys()].filter((p) => p.endsWith(".md")).sort().map((path) => ({ path, name: noteName(path) })); },
    fileRefs() { return this.notes; },
    isFolder: (path: string) => [...io.disk.keys()].some((p) => p.startsWith(`${path}/`)),
    written: (path: string) => { for (const fn of modFns) fn(path); },
    onModified: (fn: (path: string) => void) => on(modFns, fn),
  },
  editors: {
    flush: async () => {},
    hold() {},
    release() {},
    move(under: (path: string) => boolean, swap: (path: string) => string) {
      for (const [path, state] of [...states]) if (under(path)) { states.delete(path); states.set(swap(path), state); }
    },
    text: async (path: string) => states.get(path)?.doc.toString() ?? api.readNote(path),
    doc: (path: string) => states.get(path)?.doc,
    change: (path: string, spec: TransactionSpec) => void states.set(path, states.get(path)!.update(spec).state),
  },
  async followMove(swap: (path: string) => string) { for (const fn of moveFns) fn(swap); },
  onMove: (fn: (swap: (path: string) => string) => void) => on(moveFns, fn),
} as unknown as Workspace;

/** Every link update the renames started, including ones started while waiting. */
async function settle() {
  for (let seen = -1; seen !== jobs.length;) {
    seen = jobs.length;
    await Promise.all(jobs);
  }
}

beforeEach(() => {
  io.disk.clear();
  io.writes = 0;
  io.onWrite = () => {};
  io.beforeReply = async () => {};
  states.clear();
  jobs = [];
  fileSettings.renamed = (from, to, before, sources) => void jobs.push(updateLinks(ws, from, to, before, sources, style, null));
  // Every note takes 10 ms, so the update yields between notes.
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => (clock += 10));
});
afterEach(() => vi.restoreAllMocks());

const text = (path: string) => states.get(path)?.doc.toString() ?? io.disk.get(path);

test("typing in a loaded note while the update yields is kept, with or without a new line", async () => {
  io.disk.set("Old/A.md", "a");
  for (let i = 0; i < 6; i++) io.disk.set(`S${i}.md`, `[[Old/A]] in ${i}\nend`);
  states.set("S3.md", EditorState.create({ doc: "one [[Old/A]]\ntwo" }));
  states.set("S4.md", EditorState.create({ doc: "four [[Old/A]]\nfive" }));
  // After the first write (S0), the sources have all been read: type into two of them.
  io.onWrite = (n) => {
    if (n !== 1) return;
    ws.editors.change("S3.md", { changes: { from: ws.editors.doc("S3.md")!.length, insert: " USER TYPED" } });
    ws.editors.change("S4.md", { changes: { from: ws.editors.doc("S4.md")!.length, insert: "\nUSER LINE" } });
  };
  await renameFile(ws, "Old", "New");
  await settle();
  expect(text("S3.md")).toBe("one [[New/A]]\ntwo USER TYPED");
  expect(text("S4.md")).toBe("four [[New/A]]\nfive\nUSER LINE");
  expect(text("S5.md")).toBe("[[New/A]] in 5\nend");
});

test("a note saved or changed on disk while the update yields keeps that change, even one made during its reread", async () => {
  io.disk.set("Old/A.md", "a");
  for (let i = 0; i < 4; i++) io.disk.set(`S${i}.md`, `[[Old/A]] in ${i}`);
  const change = (path: string, text: string) => {
    io.disk.set(path, text);
    ws.vault.written(path);
  };
  // After the first write, both S2 and S3 change on disk and are read again.
  io.onWrite = (n) => {
    if (n !== 1) return;
    change("S2.md", "[[Old/A]] in 2\nEXTERNAL [[Old/A#Part]]");
    change("S3.md", "[[Old/A]] in 3\nFIRST CHANGE");
  };
  // S3's reread is slow: a second change lands after it took the text and before it replies.
  let reads = 0;
  io.beforeReply = async (path) => {
    if (path !== "S3.md" || ++reads !== 2) return;
    await new Promise((r) => setTimeout(r, 0));
    change("S3.md", "[[Old/A]] in 3\nFIRST CHANGE\nSECOND CHANGE [[Old/A]]");
  };
  await renameFile(ws, "Old", "New");
  await settle();
  expect(io.disk.get("S2.md")).toBe("[[New/A]] in 2\nEXTERNAL [[New/A#Part]]");
  expect(io.disk.get("S3.md")).toBe("[[New/A]] in 3\nFIRST CHANGE\nSECOND CHANGE [[New/A]]");
  expect(io.disk.get("S1.md")).toBe("[[New/A]] in 1");
});

test("moving the folder again while its links are rewritten leaves no old paths and no stale links", async () => {
  for (let i = 0; i < 20; i++) io.disk.set(`Old/N${i}.md`, `next [[Old/N${(i + 1) % 20}]]`);
  for (let i = 0; i < 40; i++) io.disk.set(`L${String(i).padStart(2, "0")}.md`, `see [[Old/N${i % 20}]] and ![[Old/N${(i + 3) % 20}#Top|t]]`);
  states.set("L30.md", EditorState.create({ doc: io.disk.get("L30.md")! }));
  let second: Promise<void> | null = null;
  io.onWrite = (n) => { if (n === 5) second = renameFile(ws, "New", "Final"); };
  await renameFile(ws, "Old", "New");
  await vi.waitFor(() => expect(second).not.toBeNull());
  await second;
  await settle();
  const paths = [...io.disk.keys()];
  expect(paths.filter((p) => isUnder(p, "New") || isUnder(p, "Old"))).toEqual([]);
  expect(paths.filter((p) => isUnder(p, "Final"))).toHaveLength(20);
  for (const path of [...paths, ...states.keys()]) {
    const body = text(path)!;
    expect(body, path).not.toMatch(/\[\[(Old|New)\//);
  }
  expect(io.disk.get("Final/N0.md")).toBe("next [[Final/N1]]");
  expect(io.disk.get("L07.md")).toBe("see [[Final/N7]] and ![[Final/N10#Top|t]]");
  expect(text("L30.md")).toBe("see [[Final/N10]] and ![[Final/N13#Top|t]]");
});
