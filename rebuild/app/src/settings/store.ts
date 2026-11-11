// The open vault's settings, read from its .grove folder once the vault is
// open and written back a moment after they change. Reads go through get();
// changes go through set(), which tells the listeners at once (so a setting
// applies on the same frame) and schedules a debounced write of that one
// file. Nothing here runs while typing: only the settings UI and a few
// commands change settings.

import { api } from "../api";
import { retryDelay } from "../fileSave";
import { listeners } from "../listeners";
import {
  defaults,
  FILES,
  type FileName,
  sanitize,
  sanitizeHotkeys,
  sanitizeTypes,
  serialize,
  serializeHotkeys,
  serializeTypes,
  type SettingsOf,
  type StoredHotkey,
} from "./schema";

export type SettingsFile = FileName | "hotkeys.json" | "types.json";

const WRITE_DELAY = 500;

class SettingsStore {
  private values = new Map<FileName, Record<string, unknown>>();
  private extras = new Map<FileName, Record<string, unknown>>();
  private hotkeyMap: Record<string, StoredHotkey[]> = {};
  private typeMap: Record<string, string> = {};
  private timers = new Map<SettingsFile, number>();
  private retryTimers = new Map<SettingsFile, number>();
  private retryAttempt = new Map<SettingsFile, number>();
  /** Files whose last write failed. flush() tries them again. */
  private failed = new Set<SettingsFile>();
  private pendingWrites = new Map<SettingsFile, Promise<void>>();
  private changes = listeners<[file: SettingsFile | null, key: string | null]>();
  /** Called with the file and key that changed (both null after a load). */
  readonly on = this.changes.on;

  constructor() {
    for (const [file, spec] of Object.entries(FILES) as [FileName, (typeof FILES)[FileName]][]) {
      this.values.set(file, defaults(spec) as Record<string, unknown>);
      this.extras.set(file, {});
    }
  }

  get<F extends FileName>(file: F): Readonly<SettingsOf<F>> {
    return this.values.get(file) as SettingsOf<F>;
  }

  /** Custom hotkeys by command id (commands not listed keep their defaults). */
  get hotkeys(): Readonly<Record<string, StoredHotkey[]>> {
    return this.hotkeyMap;
  }

  /** Property types chosen per name (types.json, in Obsidian's names: "multitext" for lists). */
  get propertyTypes(): Readonly<Record<string, string>> {
    return this.typeMap;
  }

  /**
   * True after load() when the vault's .grove folder held none of Grove's
   * settings files (a vault Grove hasn't changed a setting in), so its first
   * settings may come from Cinder's or Obsidian's. A file that exists but
   * doesn't read counts as there.
   */
  fresh = false;

  /**
   * Read every settings file of the open vault. A missing file means
   * defaults; an unreadable one, or one that isn't JSON, too (with a
   * warning), and it is left alone on disk until a setting in it changes.
   */
  async load() {
    let found = false;
    const read = async (name: SettingsFile) => {
      try {
        const text = await api.readConfig(name);
        if (text !== null) found = true;
        return text === null ? null : (JSON.parse(text) as unknown);
      } catch (err) {
        found = true;
        console.warn(`Settings: could not read .grove/${name}, using defaults`, err);
        return null;
      }
    };
    const files = Object.keys(FILES) as FileName[];
    const [hotkeys, types, ...raws] = await Promise.all([read("hotkeys.json"), read("types.json"), ...files.map(read)]);
    files.forEach((file, i) => {
      const { values, extra } = sanitize(FILES[file], raws[i]);
      this.values.set(file, values as Record<string, unknown>);
      this.extras.set(file, extra);
    });
    this.hotkeyMap = sanitizeHotkeys(hotkeys);
    this.typeMap = sanitizeTypes(types);
    this.fresh = !found;
    this.changes.emit(null, null);
  }

  /**
   * Take a vault's first settings (imported from Cinder or Obsidian) and
   * write each of `files` now, so the import isn't offered again. Values
   * Grove would refuse are skipped. Resolves to the files that couldn't be
   * saved (the values still apply until the window closes).
   */
  async adopt(values: Partial<Record<FileName, Record<string, unknown>>>, files: readonly FileName[]): Promise<string[]> {
    for (const [file, changes] of Object.entries(values) as [FileName, Record<string, unknown>][]) {
      const spec = FILES[file] as Record<string, { valid(v: unknown): boolean }>;
      const current = this.values.get(file)!;
      for (const [key, value] of Object.entries(changes)) if (spec[key]?.valid(value)) current[key] = structuredClone(value);
    }
    this.fresh = false;
    this.changes.emit(null, null);
    const failed: string[] = [];
    await Promise.all(
      files.map(async (file) => {
        clearTimeout(this.timers.get(file));
        this.timers.delete(file);
        try {
          await api.writeConfig(file, serialize(FILES[file], this.values.get(file) as never, this.extras.get(file)));
        } catch (err) {
          console.warn(`Settings: could not save .grove/${file}`, err);
          failed.push(file);
        }
      }),
    );
    return failed;
  }

  /** Change one setting. Invalid values are refused (returns false). */
  set<F extends FileName, K extends keyof SettingsOf<F> & string>(file: F, key: K, value: SettingsOf<F>[K]): boolean {
    const spec = FILES[file] as Record<string, { valid(v: unknown): boolean }>;
    if (!spec[key]?.valid(value)) return false;
    const values = this.values.get(file)!;
    if (JSON.stringify(values[key]) === JSON.stringify(value)) return true;
    values[key] = value;
    this.changed(file, key);
    return true;
  }

  /** Set a command's hotkeys; null puts back its defaults. */
  setHotkeys(id: string, hotkeys: StoredHotkey[] | null) {
    this.hotkeyMap = withEntry(this.hotkeyMap, id, hotkeys);
    this.changed("hotkeys.json", id);
  }

  /** Choose a property name's type for the vault; null makes it automatic again. */
  setPropertyType(key: string, type: string | null) {
    if ((this.typeMap[key] ?? null) === type) return;
    this.typeMap = withEntry(this.typeMap, key, type);
    this.changed("types.json", key);
  }

  /** Write everything still waiting (the window is closing). Resolves when those writes settle. */
  flush(): Promise<void> {
    const files = new Set<SettingsFile>([...this.timers.keys(), ...this.failed]);
    const jobs: Promise<void>[] = [];
    for (const file of files) if (!this.pendingWrites.has(file)) jobs.push(this.write(file));
    for (const job of this.pendingWrites.values()) jobs.push(job);
    return Promise.all(jobs).then(() => undefined);
  }

  /** Tell the listeners at once, and write the file a moment later. */
  private changed(file: SettingsFile, key: string) {
    this.changes.emit(file, key);
    clearTimeout(this.timers.get(file));
    this.timers.set(
      file,
      window.setTimeout(() => this.write(file), WRITE_DELAY),
    );
  }

  private write(file: SettingsFile): Promise<void> {
    const timer = this.timers.get(file);
    if (timer) clearTimeout(timer);
    this.timers.delete(file);
    const retry = this.retryTimers.get(file);
    if (retry) clearTimeout(retry);
    this.retryTimers.delete(file);
    const text =
      file === "hotkeys.json"
        ? serializeHotkeys(this.hotkeyMap)
        : file === "types.json"
          ? serializeTypes(this.typeMap)
          : serialize(FILES[file], this.values.get(file) as never, this.extras.get(file));
    const job = api.writeConfig(file, text).then(() => {
      this.failed.delete(file);
      this.retryAttempt.delete(file);
    }, (err) => {
      console.warn(`Settings: could not save .grove/${file}`, err);
      this.failed.add(file);
      const n = this.retryAttempt.get(file) ?? 0;
      this.retryAttempt.set(file, n + 1);
      this.retryTimers.set(file, window.setTimeout(() => { void this.write(file); }, retryDelay(n)));
    });
    this.pendingWrites.set(file, job);
    void job.finally(() => { if (this.pendingWrites.get(file) === job) this.pendingWrites.delete(file); });
    return job;
  }
}

/** A copy of a map with one entry set, or removed (null). */
function withEntry<T>(map: Record<string, T>, key: string, value: T | null): Record<string, T> {
  const next = { ...map };
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

export const settings = new SettingsStore();
