// Direct writers (link updates, properties, attachments, an unloaded note,
// a create or a copy) have no dirty set of their own. While this page does
// not own the backend they queue here, tagged with the vault captured when
// the operation was accepted. Each page stores only its own record. A reload
// reads every page's record. The switch keeps the page when that write does
// not acknowledge.

import { api, type FileEntry } from "./api";
import { retryDelay } from "./fileSave";
import {
  ackKey,
  dropKey,
  HANDOFF_PREFIX,
  itemKey,
  itemKind,
  pageStoreOf,
  storage,
  storedKeys,
  stripLegacy,
  writeItem,
  type ItemKind,
  type StoredHandoff,
} from "./handoffStore";
import { drainAllows, pathHeld } from "./holdDrain";
import { writesSealed } from "./saveSeal";
import { backendRoot, bumpPathGen, pathGen, sourceVault } from "./vaultRoot";

const pageId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
const STORE = HANDOFF_PREFIX + pageId;

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

interface CopyHandoff {
  vault: string;
  from: string;
  path: string;
  key: string;
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

interface ConfigSnap {
  name: string;
  text: string;
}

interface RawHandoff {
  vault?: string;
  path?: string;
  from?: string;
  name?: string;
  text?: string;
  gen?: number;
  kind?: string;
  content?: string;
  op?: string;
  b64?: string;
  edit?: unknown;
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
const copies: CopyHandoff[] = [];
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
  if (copies.some((job) => job.vault === vault)) return true;
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

export function queuedCopy(vault: string, from: string): string | undefined {
  return copies.find((job) => job.vault === vault && job.from === from)?.path;
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

function moveItemKey(oldKey: string, kind: ItemKind, id: string): string {
  const next = itemKey(pageStoreOf(oldKey), kind, id);
  if (oldKey !== next && itemKind(oldKey)) dropKey(oldKey);
  return next;
}

export function retargetHandoff(vault: string, under: (path: string) => boolean, swap: (path: string) => string): void {
  for (const saved of [...notes.values()]) {
    if (saved.vault !== vault || !under(saved.path)) continue;
    const from = saved.path;
    notes.delete(noteKey(saved.vault, saved.path));
    saved.path = swap(saved.path);
    const id = noteKey(saved.vault, saved.path);
    const prev = notes.get(id);
    if (itemKind(saved.key)) saved.key = moveItemKey(saved.key, "n", id);
    else stripLegacy(saved.key, (body) => ({
      ...body,
      notes: (body.notes ?? []).filter((note) => !(note.vault === vault && note.path === from)),
    }));
    if (!prev || prev.gen <= saved.gen) {
      notes.set(id, saved);
      if (itemKind(saved.key)) writeItem(saved.key, { vault: saved.vault, path: saved.path, text: saved.text, gen: saved.gen });
    }
  }
  for (const job of structural) if (job.vault === vault && under(job.path)) {
    job.path = swap(job.path);
    if (itemKind(job.key)) {
      job.key = moveItemKey(job.key, "s", `${job.vault}\0${job.path}\0${job.kind}`);
      writeItem(job.key, { vault: job.vault, kind: job.kind, path: job.path, content: job.content });
    }
  }
  for (const job of bytesJobs) if (job.vault === vault && under(job.path)) {
    job.path = swap(job.path);
    if (itemKind(job.key)) {
      job.key = moveItemKey(job.key, "b", `${job.vault}\0${job.path}\0${job.op}`);
      writeItem(job.key, { vault: job.vault, path: job.path, op: job.op, b64: job.b64 });
    }
  }
  for (const job of propJobs) if (job.vault === vault && under(job.path)) {
    job.path = swap(job.path);
    if (itemKind(job.key)) {
      job.key = moveItemKey(job.key, "p", `${job.vault}\0${job.path}`);
      writeItem(job.key, { vault: job.vault, path: job.path, edit: job.edit });
    }
  }
}

export function discardHandoff(vault: string, under: (path: string) => boolean): void {
  const legacy = new Set<string>();
  for (const saved of [...notes.values()]) {
    if (saved.vault !== vault || !under(saved.path)) continue;
    notes.delete(noteKey(saved.vault, saved.path));
    if (itemKind(saved.key)) dropKey(saved.key);
    else legacy.add(saved.key);
  }
  for (let i = structural.length - 1; i >= 0; i--) if (structural[i].vault === vault && under(structural[i].path)) {
    const job = structural.splice(i, 1)[0];
    if (itemKind(job.key)) dropKey(job.key);
    else legacy.add(job.key);
  }
  for (let i = bytesJobs.length - 1; i >= 0; i--) if (bytesJobs[i].vault === vault && under(bytesJobs[i].path)) {
    const job = bytesJobs.splice(i, 1)[0];
    if (itemKind(job.key)) dropKey(job.key);
    else legacy.add(job.key);
  }
  for (let i = propJobs.length - 1; i >= 0; i--) if (propJobs[i].vault === vault && under(propJobs[i].path)) {
    const job = propJobs.splice(i, 1)[0];
    if (itemKind(job.key)) dropKey(job.key);
    else legacy.add(job.key);
  }
  for (let i = copies.length - 1; i >= 0; i--) if (copies[i].vault === vault && (under(copies[i].from) || under(copies[i].path))) {
    const job = copies.splice(i, 1)[0];
    if (itemKind(job.key)) dropKey(job.key);
    else legacy.add(job.key);
  }
  for (const key of legacy) {
    stripLegacy(key, (body) => ({
      ...body,
      notes: (body.notes ?? []).filter((note) => !(note.vault === vault && under(note.path))),
      structural: (body.structural ?? []).filter((job) => !(job.vault === vault && under(job.path))),
      bytes: (body.bytes ?? []).filter((job) => !(job.vault === vault && under(job.path))),
      props: (body.props ?? []).filter((job) => !(job.vault === vault && under(job.path))),
    }));
  }
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

function ownKey(kind: ItemKind, id: string): string {
  return itemKey(STORE, kind, id);
}

function persistOwn(): boolean {
  const disk = storage();
  if (!disk) return false;
  let ok = true;
  const live = new Set<string>();
  const put = (key: string, value: unknown) => {
    live.add(key);
    knownKeys.add(key);
    if (!writeItem(key, value)) ok = false;
  };
  for (const note of notes.values()) {
    if (!note.key.startsWith(STORE + ".")) continue;
    put(note.key, { vault: note.vault, path: note.path, text: note.text, gen: note.gen });
  }
  for (const config of configs.values()) {
    if (!config.key.startsWith(STORE + ".")) continue;
    put(config.key, { vault: config.vault, name: config.name, text: config.text });
  }
  for (const job of structural) {
    if (!job.key.startsWith(STORE + ".")) continue;
    put(job.key, { vault: job.vault, kind: job.kind, path: job.path, content: job.content });
  }
  for (const job of bytesJobs) {
    if (!job.key.startsWith(STORE + ".")) continue;
    put(job.key, { vault: job.vault, path: job.path, op: job.op, b64: job.b64 });
  }
  for (const job of propJobs) {
    if (!job.key.startsWith(STORE + ".")) continue;
    put(job.key, { vault: job.vault, path: job.path, edit: job.edit });
  }
  for (const job of copies) {
    if (!job.key.startsWith(STORE + ".")) continue;
    put(job.key, { vault: job.vault, from: job.from, path: job.path });
  }
  for (const key of storedKeys(disk)) {
    if (!key.startsWith(STORE + ".")) continue;
    if (!live.has(key) && !dropKey(key)) ok = false;
  }
  if (ok) releaseLosers();
  return ok;
}

/** Drop an older per-item copy of a note this page just committed. */
function releaseLosers(): void {
  const mine = [...notes.values()].filter((note) => note.key.startsWith(STORE + "."));
  if (!mine.length) return;
  const disk = storage();
  if (!disk) return;
  for (const key of storedKeys(disk)) {
    if (key.startsWith(STORE + ".")) continue;
    if (itemKind(key) === "n") {
      const raw = disk.getItem(key);
      if (!raw) continue;
      let other: { vault?: string; path?: string; gen?: number };
      try { other = JSON.parse(raw) as { vault?: string; path?: string; gen?: number }; } catch { continue; }
      const hit = mine.find((note) => note.vault === other.vault && note.path === other.path && note.gen >= (other.gen ?? 0));
      if (!hit || disk.getItem(key) !== raw) continue;
      try { disk.removeItem(key); } catch { /* the other page's newer bytes stay */ }
      continue;
    }
    if (itemKind(key)) continue;
    stripLegacy(key, (body) => ({
      ...body,
      notes: (body.notes ?? []).filter((note) => !mine.some((ours) => ours.vault === note.vault && ours.path === note.path && ours.gen >= (note.gen ?? 0))),
    }));
  }
}

function rememberNote(saved: NoteHandoff, write = true): void {
  const id = noteKey(saved.vault, saved.path);
  const prev = notes.get(id);
  if (prev && prev.gen > saved.gen) return;
  const key = ownKey("n", id);
  notes.set(id, { ...saved, key, notify: saved.notify ?? prev?.notify });
  if (write) persistOwn();
}

function rememberConfig(saved: ConfigHandoff, write = true): void {
  configs.set(configKey(saved.vault, saved.name), { ...saved, key: ownKey("c", configKey(saved.vault, saved.name)) });
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
    let saved: RawHandoff | null = null;
    try { saved = JSON.parse(disk.getItem(key) ?? "null") as RawHandoff; } catch { saved = null; }
    if (!saved || typeof saved !== "object") continue;
    const kind = itemKind(key);
    if (kind === "n") { takeNote(key, saved); continue; }
    if (kind === "c") {
      if (typeof saved.vault !== "string" || typeof saved.name !== "string" || typeof saved.text !== "string") continue;
      const id = configKey(saved.vault, saved.name);
      if (!configs.has(id)) configs.set(id, { vault: saved.vault, name: saved.name, text: saved.text, key });
      continue;
    }
    if (kind === "s") {
      if ((saved.kind !== "note" && saved.kind !== "folder") || typeof saved.path !== "string" || typeof saved.vault !== "string") continue;
      structural.push({ vault: saved.vault, kind: saved.kind, path: saved.path, content: saved.content ?? "", key });
      continue;
    }
    if (kind === "b") {
      if ((saved.op !== "write" && saved.op !== "replace") || typeof saved.path !== "string" || typeof saved.b64 !== "string" || typeof saved.vault !== "string") continue;
      bytesJobs.push({ vault: saved.vault, path: saved.path, op: saved.op, b64: saved.b64, key });
      continue;
    }
    if (kind === "p") {
      if (typeof saved.path !== "string" || typeof saved.vault !== "string") continue;
      propJobs.push({ vault: saved.vault, path: saved.path, edit: saved.edit, key });
      continue;
    }
    if (kind === "y") {
      if (typeof saved.vault !== "string" || typeof saved.from !== "string" || typeof saved.path !== "string") continue;
      copies.push({ vault: saved.vault, from: saved.from, path: saved.path, key });
      continue;
    }
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
      if (!job || (job.op !== "write" && job.op !== "replace") || typeof job.path !== "string" || typeof job.b64 !== "string" || typeof job.vault !== "string") continue;
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
    structural.push({ vault: source, kind, path, content, key: ownKey("s", `${source}\0${path}\0${kind}`), resolve });
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
    bytesJobs.push({ vault: source, path, op, b64: encodeBytes(bytes), key: ownKey("b", `${source}\0${path}\0${op}`), resolve });
    persistOwn();
  });
}

/** A property edit accepted for `source`, replayed with the same payload. */
export function submitProperty(source: string, path: string, edit: unknown): Promise<unknown> {
  if (canSubmit(source, path)) return track(api.setProperty(path, edit as never, false));
  return new Promise((resolve) => {
    propJobs.push({ vault: source, path, edit, key: ownKey("p", `${source}\0${path}`), resolve });
    persistOwn();
  });
}

/** Read `from` and create `path` only once `source` is the backend again. */
export function queueVaultCopy(source: string, from: string, path: string): Promise<FileEntry> {
  return new Promise((resolve) => {
    copies.push({ vault: source, from, path, key: ownKey("y", `${source}\0${from}\0${path}`), resolve });
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
  const copyJobs = copies.filter((job) => job.vault === vault && !heldBack(job.from) && !heldBack(job.path));
  const deferred = later.filter((job) => job.vault === vault);
  for (const note of noteEntries) notes.delete(noteKey(note.vault, note.path));
  for (const config of configEntries) configs.delete(configKey(config.vault, config.name));
  const pull = <T>(list: T[], job: T) => {
    const at = list.indexOf(job);
    if (at >= 0) list.splice(at, 1);
  };
  for (const job of jobs) pull(structural, job);
  for (const job of files) pull(bytesJobs, job);
  for (const job of props) pull(propJobs, job);
  for (const job of copyJobs) pull(copies, job);
  for (const job of deferred) pull(later, job);
  const ack = (key: string, edit: (body: StoredHandoff) => StoredHandoff) => ackKey(key, edit);
  let failed = false;
  await Promise.all([
    ...noteEntries.map(async (saved) => {
      const id = noteKey(saved.vault, saved.path);
      if (pathGen(saved.path) > saved.gen) {
        ack(saved.key, (body) => ({ ...body, notes: (body.notes ?? []).filter((note) => !(note.vault === saved.vault && note.path === saved.path)) }));
        return;
      }
      sending.set(id, saved.text);
      try {
        await track(api.writeNote(saved.path, saved.text));
        try { saved.notify?.(); } catch { /* the bytes landed */ }
        ack(saved.key, (body) => ({ ...body, notes: (body.notes ?? []).filter((note) => !(note.vault === saved.vault && note.path === saved.path && (note.gen ?? 0) <= saved.gen)) }));
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
        ack(saved.key, (body) => ({ ...body, configs: (body.configs ?? []).filter((config) => !(config.vault === saved.vault && config.name === saved.name)) }));
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
        ack(job.key, (body) => ({ ...body, structural: (body.structural ?? []).filter((row) => !(row.vault === job.vault && row.path === job.path && row.kind === job.kind)) }));
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
        ack(job.key, (body) => ({ ...body, bytes: (body.bytes ?? []).filter((row) => !(row.vault === job.vault && row.path === job.path && row.op === job.op)) }));
        job.resolve?.();
      } catch {
        failed = true;
        if (!bytesJobs.includes(job)) bytesJobs.push(job);
      }
    }),
    ...props.map(async (job) => {
      try {
        const result = await track(api.setProperty(job.path, job.edit as never, false));
        ack(job.key, (body) => ({ ...body, props: (body.props ?? []).filter((row) => !(row.vault === job.vault && row.path === job.path)) }));
        job.resolve?.(result);
      } catch {
        failed = true;
        if (!propJobs.includes(job)) propJobs.push(job);
      }
    }),
    ...copyJobs.map(async (job) => {
      try {
        if (backendRoot() !== job.vault || writesSealed()) {
          failed = true;
          if (!copies.includes(job)) copies.push(job);
          return;
        }
        const content = await api.readNote(job.from);
        if (backendRoot() !== job.vault || writesSealed()) {
          failed = true;
          if (!copies.includes(job)) copies.push(job);
          return;
        }
        const entry = await api.createNote(job.path, content);
        ack(job.key, (body) => body);
        job.resolve?.(entry);
      } catch {
        failed = true;
        if (!copies.includes(job)) copies.push(job);
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
  copies.splice(0);
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
  copies.splice(0);
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
