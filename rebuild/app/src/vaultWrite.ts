// Direct writers (link updates, properties, attachments, an unloaded note,
// a create or a copy) have no dirty set of their own. While this page does
// not own the backend they queue here, tagged with the vault captured when
// the operation was accepted. Each page stores only its own record. A reload
// reads every page's record. The switch keeps the page when that write does
// not acknowledge.

import { api, type FileEntry } from "./api";
import { retryDelay } from "./fileSave";
import { drainAllows, pathHeld } from "./holdDrain";
import { writesSealed } from "./saveSeal";
import { backendRoot, bumpPathGen, pathGen, sourceVault } from "./vaultRoot";

const PREFIX = "grove.saveHandoff.";
const pageId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
const STORE = PREFIX + pageId;

interface NoteHandoff {
  vault: string;
  path: string;
  text: string;
  gen: number;
  key: string;
  notify?: () => void;
}

interface ConfigHandoff {
  vault: string;
  name: string;
  text: string;
  key: string;
}

interface StructHandoff {
  vault: string;
  kind: "note" | "folder";
  path: string;
  content: string;
  key: string;
  resolve?: (entry: FileEntry) => void;
}

interface BytesHandoff {
  vault: string;
  path: string;
  op: "write" | "replace";
  b64: string;
  key: string;
  resolve?: () => void;
}

interface PropHandoff {
  vault: string;
  path: string;
  edit: unknown;
  key: string;
  resolve?: (result: unknown) => void;
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

interface ConfigSnap {
  name: string;
  text: string;
}

interface StoredHandoff {
  notes?: { vault: string; path: string; text: string; gen?: number }[];
  configs?: { vault: string; name: string; text: string }[];
  structural?: { vault: string; kind: string; path: string; content?: string }[];
  bytes?: { vault: string; path: string; op: string; b64: string }[];
  props?: { vault: string; path: string; edit: unknown }[];
}

let quiet: Promise<void> = Promise.resolve();
const notes = new Map<string, NoteHandoff>();
const configs = new Map<string, ConfigHandoff>();
const structural: StructHandoff[] = [];
const bytesJobs: BytesHandoff[] = [];
const propJobs: PropHandoff[] = [];
const later: LaterJob[] = [];
const sending = new Map<string, string>();
const sendingConfig = new Map<string, string>();
const knownKeys = new Set<string>([STORE]);
let captureDirty: () => DirtySnap[] = () => [];
let captureConfig: () => ConfigSnap[] = () => [];
let retryTimer = 0;
let retryAttempt = 0;

const noteKey = (vault: string, path: string) => `${vault}\0${path}`;
const configKey = (vault: string, name: string) => `${vault}\0${name}`;

export function setDirtyCapture(fn: () => DirtySnap[]): void {
  captureDirty = fn;
}

export function setConfigCapture(fn: () => ConfigSnap[]): void {
  captureConfig = fn;
}

export function handoffPending(vault = backendRoot()): boolean {
  for (const note of notes.values()) if (note.vault === vault) return true;
  for (const config of configs.values()) if (config.vault === vault) return true;
  if (structural.some((job) => job.vault === vault)) return true;
  if (bytesJobs.some((job) => job.vault === vault)) return true;
  if (propJobs.some((job) => job.vault === vault)) return true;
  if (later.some((job) => job.vault === vault)) return true;
  return false;
}

export function queuedNote(vault: string, path: string): string | undefined {
  return notes.get(noteKey(vault, path))?.text;
}

export function queuedConfig(vault: string, name: string): string | undefined {
  return configs.get(configKey(vault, name))?.text;
}

export function queuedBytes(vault: string, path: string): string | undefined {
  return bytesJobs.find((job) => job.vault === vault && job.path === path)?.b64;
}

export function queuedStructural(): { vault: string; kind: string; path: string; content: string }[] {
  return structural.map(({ vault, kind, path, content }) => ({ vault, kind, path, content }));
}

export function queuedProp(vault: string, path: string): unknown {
  return propJobs.find((job) => job.vault === vault && job.path === path)?.edit;
}

/** Queued text, or a recovery write that has left the queue but not finished. */
export function authoritativeNote(vault: string, path: string): string | undefined {
  return sending.get(noteKey(vault, path)) ?? notes.get(noteKey(vault, path))?.text;
}

export function authoritativeConfig(vault: string, name: string): string | undefined {
  return sendingConfig.get(configKey(vault, name)) ?? configs.get(configKey(vault, name))?.text;
}

function heldBack(path: string): boolean {
  return pathHeld(path) && !drainAllows(path);
}

/** Same turn as the backend call: the captured vault must still be the one executing. */
function canSubmit(vault: string, path?: string): boolean {
  if (writesSealed() || backendRoot() !== vault) return false;
  if (path && heldBack(path)) return false;
  return true;
}

export function retargetHandoff(vault: string, under: (path: string) => boolean, swap: (path: string) => string): void {
  const touched = new Set<string>();
  for (const saved of [...notes.values()]) {
    if (saved.vault !== vault || !under(saved.path)) continue;
    touched.add(saved.key);
    notes.delete(noteKey(saved.vault, saved.path));
    saved.path = swap(saved.path);
    const key = noteKey(saved.vault, saved.path);
    const prev = notes.get(key);
    if (!prev || prev.gen <= saved.gen) notes.set(key, saved);
    else touched.add(prev.key);
  }
  for (const job of structural) if (job.vault === vault && under(job.path)) { touched.add(job.key); job.path = swap(job.path); }
  for (const job of bytesJobs) if (job.vault === vault && under(job.path)) { touched.add(job.key); job.path = swap(job.path); }
  for (const job of propJobs) if (job.vault === vault && under(job.path)) { touched.add(job.key); job.path = swap(job.path); }
  persistKeys(touched);
}

export function discardHandoff(vault: string, under: (path: string) => boolean): void {
  const touched = new Set<string>();
  for (const saved of [...notes.values()]) {
    if (saved.vault === vault && under(saved.path)) {
      touched.add(saved.key);
      notes.delete(noteKey(saved.vault, saved.path));
    }
  }
  for (let i = structural.length - 1; i >= 0; i--) if (structural[i].vault === vault && under(structural[i].path)) { touched.add(structural[i].key); structural.splice(i, 1); }
  for (let i = bytesJobs.length - 1; i >= 0; i--) if (bytesJobs[i].vault === vault && under(bytesJobs[i].path)) { touched.add(bytesJobs[i].key); bytesJobs.splice(i, 1); }
  for (let i = propJobs.length - 1; i >= 0; i--) if (propJobs[i].vault === vault && under(propJobs[i].path)) { touched.add(propJobs[i].key); propJobs.splice(i, 1); }
  persistKeys(touched);
}

export function vaultQuiet(): Promise<void> {
  return quiet;
}

function track<T>(work: Promise<T>): Promise<T> {
  const done = work.finally(() => {});
  const settled = done.then(() => {}, () => {});
  quiet = quiet.then(() => settled);
  return done;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function storedKeys(disk: Storage): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < disk.length; i++) {
      const key = disk.key(i);
      if (key && key.startsWith(PREFIX)) out.push(key);
    }
  } catch { /* a storage that cannot be listed keeps the keys we already know */ }
  return out;
}

function bodyOf(key: string): StoredHandoff {
  const mine = (row: { key: string }) => row.key === key;
  return {
    notes: [...notes.values()].filter(mine).map(({ vault, path, text, gen }) => ({ vault, path, text, gen })),
    configs: [...configs.values()].filter(mine).map(({ vault, name, text }) => ({ vault, name, text })),
    structural: structural.filter(mine).map(({ vault, kind, path, content }) => ({ vault, kind, path, content })),
    bytes: bytesJobs.filter(mine).map(({ vault, path, op, b64 }) => ({ vault, path, op, b64 })),
    props: propJobs.filter(mine).map(({ vault, path, edit }) => ({ vault, path, edit })),
  };
}

function emptyBody(body: StoredHandoff): boolean {
  return !body.notes?.length && !body.configs?.length && !body.structural?.length && !body.bytes?.length && !body.props?.length;
}

/** Write one page's record and read it back. False when storage refuses or disagrees. */
function persistKey(key: string): boolean {
  const disk = storage();
  if (!disk) return false;
  const body = bodyOf(key);
  try {
    if (emptyBody(body)) {
      disk.removeItem(key);
      return disk.getItem(key) === null;
    }
    const json = JSON.stringify(body);
    disk.setItem(key, json);
    return disk.getItem(key) === json;
  } catch {
    return false;
  }
}

function persistKeys(keys: Iterable<string>): boolean {
  let ok = true;
  for (const key of keys) if (!persistKey(key)) ok = false;
  return ok;
}

function persistOwn(): boolean {
  knownKeys.add(STORE);
  const ok = persistKey(STORE);
  if (ok) releaseLosers(bodyOf(STORE));
  return ok;
}

/** Drop an older copy of a note this page just committed, so a later boot cannot bring it back. */
function releaseLosers(body: StoredHandoff): void {
  const mine = new Map<string, number>();
  for (const note of body.notes ?? []) mine.set(noteKey(note.vault, note.path), note.gen ?? 0);
  if (!mine.size) return;
  const disk = storage();
  if (!disk) return;
  for (const key of storedKeys(disk)) {
    if (key === STORE) continue;
    const raw = disk.getItem(key);
    if (!raw) continue;
    let saved: StoredHandoff | null = null;
    try { saved = JSON.parse(raw) as StoredHandoff; } catch { saved = null; }
    if (!saved || !Array.isArray(saved.notes)) continue;
    let changed = false;
    const kept = saved.notes.filter((note) => {
      if (!note || typeof note.path !== "string" || typeof note.vault !== "string") return true;
      const gen = mine.get(noteKey(note.vault, note.path));
      if (gen === undefined || gen < (note.gen ?? 0)) return true;
      changed = true;
      return false;
    });
    if (!changed) continue;
    const next: StoredHandoff = { ...saved, notes: kept };
    try {
      if (emptyBody(next)) {
        disk.removeItem(key);
      } else {
        const json = JSON.stringify(next);
        disk.setItem(key, json);
      }
    } catch { /* the newer copy is already in this page's record */ }
  }
}

function rememberNote(saved: NoteHandoff, write = true): void {
  const id = noteKey(saved.vault, saved.path);
  const prev = notes.get(id);
  if (prev && prev.gen > saved.gen) return;
  notes.set(id, { ...saved, key: STORE, notify: saved.notify ?? prev?.notify });
  knownKeys.add(STORE);
  if (write) persistOwn();
}

function rememberConfig(saved: ConfigHandoff, write = true): void {
  configs.set(configKey(saved.vault, saved.name), { ...saved, key: STORE });
  if (write) persistOwn();
}

/**
 * One durable commit of every accepted generation for `vault`.
 * False means the record was not acknowledged: the caller must keep the page.
 */
export function preserveAccepted(vault: string): boolean {
  if (!vault) return false;
  for (const snap of captureDirty()) rememberNote({ vault, path: snap.path, text: snap.text, gen: snap.gen, key: STORE }, false);
  for (const cfg of captureConfig()) rememberConfig({ vault, name: cfg.name, text: cfg.text, key: STORE }, false);
  return persistOwn();
}

function takeNote(key: string, note: { vault?: string; path?: string; text?: string; gen?: number } | undefined): void {
  if (!note || typeof note.vault !== "string" || typeof note.path !== "string" || typeof note.text !== "string") return;
  const id = noteKey(note.vault, note.path);
  const next: NoteHandoff = { vault: note.vault, path: note.path, text: note.text, gen: note.gen ?? 0, key };
  const prev = notes.get(id);
  if (prev && prev.gen > next.gen) return;
  notes.set(id, next);
}

function loadStored(): void {
  const disk = storage();
  if (!disk) return;
  for (const key of storedKeys(disk)) {
    knownKeys.add(key);
    let saved: StoredHandoff | null = null;
    try { saved = JSON.parse(disk.getItem(key) ?? "null") as StoredHandoff | null; } catch { saved = null; }
    if (!saved || typeof saved !== "object") continue;
    for (const note of saved.notes ?? []) takeNote(key, note);
    for (const config of saved.configs ?? []) {
      if (!config || typeof config.vault !== "string" || typeof config.name !== "string" || typeof config.text !== "string") continue;
      const id = configKey(config.vault, config.name);
      if (!configs.has(id)) configs.set(id, { vault: config.vault, name: config.name, text: config.text, key });
    }
    for (const job of saved.structural ?? []) {
      if (!job || (job.kind !== "note" && job.kind !== "folder") || typeof job.path !== "string" || typeof job.vault !== "string") continue;
      structural.push({ vault: job.vault, kind: job.kind, path: job.path, content: job.content ?? "", key });
    }
    for (const job of saved.bytes ?? []) {
      if (!job || (job.op !== "write" && job.op !== "replace") || typeof job.path !== "string" || typeof job.b64 !== "string") continue;
      bytesJobs.push({ vault: job.vault, path: job.path, op: job.op, b64: job.b64, key });
    }
    for (const job of saved.props ?? []) {
      if (!job || typeof job.path !== "string" || typeof job.vault !== "string") continue;
      propJobs.push({ vault: job.vault, path: job.path, edit: job.edit, key });
    }
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

function encodeBytes(bytes: Uint8Array): string {
  const parts: string[] = [];
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + size, bytes.length))));
  }
  return btoa(parts.join(""));
}

function decodeBytes(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function writeVaultNote(path: string, text: string, notify?: () => void, gen?: number, source = sourceVault()): Promise<"queued" | "sent"> {
  const version = gen ?? bumpPathGen(path);
  if (!canSubmit(source, path)) {
    rememberNote({ vault: source, path, text, gen: version, notify, key: STORE });
    return "queued";
  }
  await track(api.writeNote(path, text));
  try { notify?.(); } catch { /* the bytes landed; a listener can fail on its own */ }
  return "sent";
}

export async function writeVaultConfig(name: string, text: string, source = sourceVault()): Promise<"queued" | "sent"> {
  if (!canSubmit(source)) {
    rememberConfig({ vault: source, name, text, key: STORE });
    return "queued";
  }
  await track(api.writeConfig(name, text));
  return "sent";
}

export function queueVaultCreate(kind: "note" | "folder", path: string, content = "", source = sourceVault()): Promise<FileEntry> {
  return new Promise((resolve) => {
    structural.push({ vault: source, kind, path, content, key: STORE, resolve });
    persistOwn();
  });
}

/** Attachment or export bytes. The captured `source` is checked again at submission. */
export function submitBytes(source: string, path: string, bytes: Uint8Array, op: "write" | "replace"): Promise<void> {
  if (canSubmit(source, path)) {
    const work = op === "replace" ? api.replaceFileBytes(path, bytes) : api.writeFileBytes(path, bytes);
    return track(work).then(() => {});
  }
  return new Promise((resolve) => {
    bytesJobs.push({ vault: source, path, op, b64: encodeBytes(bytes), key: STORE, resolve });
    persistOwn();
  });
}

/** A property edit accepted for `source`, replayed with the same payload. */
export function submitProperty(source: string, path: string, edit: unknown): Promise<unknown> {
  if (canSubmit(source, path)) return track(api.setProperty(path, edit as never, false));
  return new Promise((resolve) => {
    propJobs.push({ vault: source, path, edit, key: STORE, resolve });
    persistOwn();
  });
}

export function runOnVault(work: () => Promise<void>, source = sourceVault()): Promise<void> {
  if (canSubmit(source)) return track(work());
  return new Promise((resolve, reject) => {
    later.push({
      vault: source,
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

export async function flushHandoff(): Promise<boolean> {
  if (writesSealed()) return false;
  const vault = backendRoot();
  const noteEntries = [...notes.values()].filter((note) => note.vault === vault && !heldBack(note.path));
  const configEntries = [...configs.values()].filter((config) => config.vault === vault);
  const jobs = structural.filter((job) => job.vault === vault && !heldBack(job.path));
  const files = bytesJobs.filter((job) => job.vault === vault && !heldBack(job.path));
  const props = propJobs.filter((job) => job.vault === vault && !heldBack(job.path));
  const deferred = later.filter((job) => job.vault === vault);
  const touched = new Set<string>();
  for (const row of [...noteEntries, ...configEntries, ...jobs, ...files, ...props]) touched.add(row.key);
  for (const note of noteEntries) notes.delete(noteKey(note.vault, note.path));
  for (const config of configEntries) configs.delete(configKey(config.vault, config.name));
  const pull = <T>(list: T[], job: T) => {
    const at = list.indexOf(job);
    if (at >= 0) list.splice(at, 1);
  };
  for (const job of jobs) pull(structural, job);
  for (const job of files) pull(bytesJobs, job);
  for (const job of props) pull(propJobs, job);
  for (const job of deferred) pull(later, job);
  let failed = false;
  await Promise.all([
    ...noteEntries.map(async (saved) => {
      if (pathGen(saved.path) > saved.gen) return;
      const id = noteKey(saved.vault, saved.path);
      sending.set(id, saved.text);
      try {
        await track(api.writeNote(saved.path, saved.text));
        try { saved.notify?.(); } catch { /* the bytes landed */ }
      } catch {
        failed = true;
        if (!notes.has(id)) notes.set(id, saved);
      } finally { sending.delete(id); }
    }),
    ...configEntries.map(async (saved) => {
      const id = configKey(saved.vault, saved.name);
      sendingConfig.set(id, saved.text);
      try {
        await track(api.writeConfig(saved.name, saved.text));
      } catch {
        failed = true;
        if (!configs.has(id)) configs.set(id, saved);
      } finally { sendingConfig.delete(id); }
    }),
    ...jobs.map(async (job) => {
      try {
        const entry = job.kind === "folder"
          ? await track(api.createFolder(job.path))
          : await track(api.createNote(job.path, job.content));
        job.resolve?.(entry);
      } catch {
        failed = true;
        if (!structural.includes(job)) structural.push(job);
      }
    }),
    ...files.map(async (job) => {
      try {
        const raw = decodeBytes(job.b64);
        if (job.op === "replace") await track(api.replaceFileBytes(job.path, raw));
        else await track(api.writeFileBytes(job.path, raw));
        job.resolve?.();
      } catch {
        failed = true;
        if (!bytesJobs.includes(job)) bytesJobs.push(job);
      }
    }),
    ...props.map(async (job) => {
      try {
        const result = await track(api.setProperty(job.path, job.edit as never, false));
        job.resolve?.(result);
      } catch {
        failed = true;
        if (!propJobs.includes(job)) propJobs.push(job);
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
  persistKeys(touched);
  if (failed) scheduleRetry();
  else if (!handoffPending(vault)) clearRetry();
  return !failed;
}

export function replayHandoff(): Promise<boolean> {
  return flushHandoff();
}

export function restoreDurableHandoff(): void {
  notes.clear();
  configs.clear();
  structural.splice(0);
  bytesJobs.splice(0);
  propJobs.splice(0);
  later.splice(0);
  sending.clear();
  sendingConfig.clear();
  loadStored();
}

export function resetHandoffForTests(): void {
  notes.clear();
  configs.clear();
  structural.splice(0);
  bytesJobs.splice(0);
  propJobs.splice(0);
  later.splice(0);
  sending.clear();
  sendingConfig.clear();
  captureDirty = () => [];
  captureConfig = () => [];
  clearRetry();
  const disk = storage();
  if (!disk) return;
  for (const key of storedKeys(disk)) {
    try { disk.removeItem(key); } catch { /* already gone */ }
  }
  knownKeys.clear();
  knownKeys.add(STORE);
}
