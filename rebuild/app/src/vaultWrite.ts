// Direct writers (link updates, properties, attachments, an unloaded note,
// a create or a copy) have no dirty set of their own. While a vault switch
// has sealed saves they queue here, bound to the vault they were accepted
// on, and go out only when that vault is the backend root again. A queued
// write is not a success: callers must not treat the bytes as landed.
// The queue is also stored, so a reload cannot drop it.

import { api, type FileEntry } from "./api";
import { retryDelay } from "./fileSave";
import { writesSealed } from "./saveSeal";
import { readStored, store } from "./storage";
import { backendRoot, bumpPathGen, pathGen } from "./vaultRoot";

const STORE = "grove.saveHandoff";

interface NoteHandoff {
  vault: string;
  path: string;
  text: string;
  gen: number;
  notify?: () => void;
}

interface ConfigHandoff {
  vault: string;
  name: string;
  text: string;
}

interface StructHandoff {
  vault: string;
  kind: "note" | "folder";
  path: string;
  content: string;
  resolve?: (entry: FileEntry) => void;
}

interface LaterJob {
  vault: string;
  run: () => Promise<void>;
}

interface DirtySnap {
  path: string;
  text: string;
  gen: number;
}

interface StoredHandoff {
  notes?: NoteHandoff[];
  configs?: ConfigHandoff[];
  structural?: StructHandoff[];
}

let quiet: Promise<void> = Promise.resolve();
const notes = new Map<string, NoteHandoff>();
const configs = new Map<string, ConfigHandoff>();
const structural: StructHandoff[] = [];
const later: LaterJob[] = [];
let captureDirty: () => DirtySnap[] = () => [];
let retryTimer = 0;
let retryAttempt = 0;

const noteKey = (vault: string, path: string) => `${vault}\0${path}`;
const configKey = (vault: string, name: string) => `${vault}\0${name}`;

/** Editors and owned canvases register the text a reload must keep. */
export function setDirtyCapture(fn: () => DirtySnap[]): void {
  captureDirty = fn;
}

/** True when a direct write for `vault` (the open root, by default) is waiting. */
export function handoffPending(vault = backendRoot()): boolean {
  for (const note of notes.values()) if (note.vault === vault) return true;
  for (const config of configs.values()) if (config.vault === vault) return true;
  if (structural.some((job) => job.vault === vault)) return true;
  if (later.some((job) => job.vault === vault)) return true;
  return false;
}

/** Queued note text for tests and a replay check. Undefined when nothing is waiting. */
export function queuedNote(vault: string, path: string): string | undefined {
  return notes.get(noteKey(vault, path))?.text;
}

/** A rename carries a queued snapshot to the new path so a retry cannot recreate the source. */
export function retargetHandoff(under: (path: string) => boolean, swap: (path: string) => string): void {
  for (const saved of [...notes.values()]) {
    if (!under(saved.path)) continue;
    notes.delete(noteKey(saved.vault, saved.path));
    saved.path = swap(saved.path);
    const key = noteKey(saved.vault, saved.path);
    const prev = notes.get(key);
    if (!prev || prev.gen <= saved.gen) notes.set(key, saved);
  }
  for (const job of structural) if (under(job.path)) job.path = swap(job.path);
  persist();
}

/** A delete drops queued writes of that path so a retry cannot recreate the file. */
export function discardHandoff(under: (path: string) => boolean): void {
  for (const saved of [...notes.values()]) if (under(saved.path)) notes.delete(noteKey(saved.vault, saved.path));
  for (let i = structural.length - 1; i >= 0; i--) if (under(structural[i].path)) structural.splice(i, 1);
  persist();
}

/** Resolves when every write that already started has settled. */
export function vaultQuiet(): Promise<void> {
  return quiet;
}

function track<T>(work: Promise<T>): Promise<T> {
  const done = work.finally(() => {});
  const settled = done.then(() => {}, () => {});
  quiet = quiet.then(() => settled);
  return done;
}

function persist(): void {
  store(STORE, {
    notes: [...notes.values()].map(({ vault, path, text, gen }) => ({ vault, path, text, gen })),
    configs: [...configs.values()],
    structural: structural.map(({ vault, kind, path, content }) => ({ vault, kind, path, content })),
  });
}

function rememberNote(saved: NoteHandoff): void {
  const key = noteKey(saved.vault, saved.path);
  const prev = notes.get(key);
  if (prev && prev.gen > saved.gen) return;
  notes.set(key, { ...saved, notify: saved.notify ?? prev?.notify });
  persist();
}

/** Copy every accepted dirty generation into the durable queue for `vault`. Synchronous. */
export function preserveAccepted(vault: string): void {
  if (!vault) return;
  for (const snap of captureDirty()) rememberNote({ vault, path: snap.path, text: snap.text, gen: snap.gen });
}

function loadStored(): void {
  const saved = readStored(STORE, null) as StoredHandoff | null;
  if (!saved || typeof saved !== "object") return;
  for (const note of saved.notes ?? []) {
    if (!note || typeof note.vault !== "string" || typeof note.path !== "string" || typeof note.text !== "string") continue;
    notes.set(noteKey(note.vault, note.path), { vault: note.vault, path: note.path, text: note.text, gen: note.gen ?? 0 });
  }
  for (const config of saved.configs ?? []) {
    if (!config || typeof config.vault !== "string" || typeof config.name !== "string") continue;
    configs.set(configKey(config.vault, config.name), config);
  }
  for (const job of saved.structural ?? []) {
    if (!job || (job.kind !== "note" && job.kind !== "folder") || typeof job.path !== "string") continue;
    structural.push({ vault: job.vault, kind: job.kind, path: job.path, content: job.content ?? "" });
  }
}

loadStored();

function clearRetry(): void {
  clearTimeout(retryTimer);
  retryTimer = 0;
  retryAttempt = 0;
}

function scheduleRetry(): void {
  if (retryTimer || writesSealed() || !handoffPending()) return;
  if (typeof window === "undefined") return;
  const wait = retryDelay(retryAttempt);
  retryAttempt += 1;
  retryTimer = window.setTimeout(() => {
    retryTimer = 0;
    void flushHandoff();
  }, wait);
}

export async function writeVaultNote(path: string, text: string, notify?: () => void, gen?: number): Promise<"queued" | "sent"> {
  const vault = backendRoot();
  const version = gen ?? bumpPathGen(path);
  // The root check and the decision to send are the same turn: nothing awaits between them.
  if (writesSealed() || backendRoot() !== vault) {
    rememberNote({ vault, path, text, gen: version, notify });
    return "queued";
  }
  await track(api.writeNote(path, text));
  try { notify?.(); } catch { /* the bytes landed; a listener can fail on its own */ }
  return "sent";
}

export async function writeVaultConfig(name: string, text: string): Promise<"queued" | "sent"> {
  const vault = backendRoot();
  if (writesSealed() || backendRoot() !== vault) {
    configs.set(configKey(vault, name), { vault, name, text });
    persist();
    return "queued";
  }
  await track(api.writeConfig(name, text));
  return "sent";
}

/** A create or a copy accepted while sealed. It runs only when `vault` is the root again. */
export function queueVaultCreate(kind: "note" | "folder", path: string, content = ""): Promise<FileEntry> {
  const vault = backendRoot();
  return new Promise((resolve) => {
    structural.push({ vault, kind, path, content, resolve });
    persist();
  });
}

/**
 * Run `work` against the current vault, or after the seal lifts on that same vault.
 * The vault switch itself must not await this from inside `open`, or the handoff cannot run.
 */
export function runOnVault(work: () => Promise<void>): Promise<void> {
  const vault = backendRoot();
  if (!writesSealed() && backendRoot() === vault) return track(work());
  return new Promise((resolve, reject) => {
    later.push({
      vault,
      run: async () => {
        try {
          await work();
          resolve();
        } catch (err) {
          reject(err);
          throw err;
        }
      },
    });
  });
}

/** Send everything queued for the open root. Other vaults stay queued. False leaves a failure queued. */
export async function flushHandoff(): Promise<boolean> {
  if (writesSealed()) return false;
  const vault = backendRoot();
  const noteEntries = [...notes.values()].filter((note) => note.vault === vault);
  const configEntries = [...configs.values()].filter((config) => config.vault === vault);
  const jobs = structural.filter((job) => job.vault === vault);
  const deferred = later.filter((job) => job.vault === vault);
  for (const note of noteEntries) notes.delete(noteKey(note.vault, note.path));
  for (const config of configEntries) configs.delete(configKey(config.vault, config.name));
  for (const job of jobs) {
    const at = structural.indexOf(job);
    if (at >= 0) structural.splice(at, 1);
  }
  for (const job of deferred) {
    const at = later.indexOf(job);
    if (at >= 0) later.splice(at, 1);
  }
  let failed = false;
  await Promise.all([
    ...noteEntries.map(async (saved) => {
      // A newer editor generation owns the path. Writing this snapshot would roll it back.
      if (pathGen(saved.path) > saved.gen) return;
      try {
        await track(api.writeNote(saved.path, saved.text));
        try { saved.notify?.(); } catch { /* the bytes landed */ }
      } catch {
        failed = true;
        const key = noteKey(saved.vault, saved.path);
        if (!notes.has(key)) notes.set(key, saved);
      }
    }),
    ...configEntries.map(async (saved) => {
      try {
        await track(api.writeConfig(saved.name, saved.text));
      } catch {
        failed = true;
        const key = configKey(saved.vault, saved.name);
        if (!configs.has(key)) configs.set(key, saved);
      }
    }),
    ...jobs.map(async (job) => {
      try {
        const entry = job.kind === "folder"
          ? await track(api.createFolder(job.path))
          : await track(api.createNote(job.path, job.content));
        job.resolve?.(entry);
      } catch {
        failed = true;
        // The caller's promise stays pending so a later retry can still resolve it.
        if (!structural.includes(job)) structural.push(job);
      }
    }),
    ...deferred.map(async (job) => {
      try {
        await job.run();
      } catch {
        failed = true;
        if (!later.includes(job)) later.push(job);
      }
    }),
  ]);
  persist();
  if (failed) scheduleRetry();
  else if (!handoffPending(vault)) clearRetry();
  return !failed;
}

/** Write durable entries whose vault is the open root. A different root keeps them. */
export function replayHandoff(): Promise<boolean> {
  return flushHandoff();
}

/** Tests drop the in-memory queue and read back what was stored. */
export function restoreDurableHandoff(): void {
  notes.clear();
  configs.clear();
  structural.splice(0);
  later.splice(0);
  loadStored();
}

export function resetHandoffForTests(): void {
  notes.clear();
  configs.clear();
  structural.splice(0);
  later.splice(0);
  captureDirty = () => [];
  clearRetry();
  try { localStorage.removeItem(STORE); } catch { /* no storage */ }
}
