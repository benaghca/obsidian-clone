// The open vault's settings, read from its .grove folder once the vault is
// open and written back a moment after they change. Reads go through get();
// changes go through set(), which tells the listeners at once (so a setting
// applies on the same frame) and schedules a debounced write of that one
// file. Nothing here runs while typing: only the settings UI and a few
// commands change settings.

import { api } from "../api";
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
   * Read every settings file of the open vault. A missing file means
   * defaults; an unreadable one, or one that isn't JSON, too (with a
   * warning), and it is left alone on disk until a setting in it changes.
   */
  async load() {
    const read = async (name: SettingsFile) => {
      try {
        const text = await api.readConfig(name);
        return text === null ? null : (JSON.parse(text) as unknown);
      } catch (err) {
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
    this.changes.emit(null, null);
  }

  /** Change one setting. Invalid values are refused (returns false). */
  set<F extends FileName, K extends keyof SettingsOf<F> & string>(file: F, key: K, value: SettingsOf<F>[K]): boolean {
    const spec = FILES[file] as Record<string, { valid(v: unknown): boolean }>;
    if (!spec[key]?.valid(value)) return false;
    const values = this.values.get(file)!;
    if (JSON.stringify(values[key]) === JSON.stringify(value)) return true;
    values[key] = value;
    this.changes.emit(file, key);
    this.schedule(file);
    return true;
  }

  /** Set a command's hotkeys; null puts back its defaults. */
  setHotkeys(id: string, hotkeys: StoredHotkey[] | null) {
    const next = { ...this.hotkeyMap };
    if (hotkeys) next[id] = hotkeys;
    else delete next[id];
    this.hotkeyMap = next;
    this.changes.emit("hotkeys.json", id);
    this.schedule("hotkeys.json");
  }

  /** Choose a property name's type for the vault; null makes it automatic again. */
  setPropertyType(key: string, type: string | null) {
    if ((this.typeMap[key] ?? null) === type) return;
    const next = { ...this.typeMap };
    if (type) next[key] = type;
    else delete next[key];
    this.typeMap = next;
    this.changes.emit("types.json", key);
    this.schedule("types.json");
  }

  /** Write everything still waiting (the window is closing). */
  flush() {
    for (const [file, timer] of [...this.timers]) {
      clearTimeout(timer);
      this.write(file);
    }
  }

  private schedule(file: SettingsFile) {
    clearTimeout(this.timers.get(file));
    this.timers.set(
      file,
      window.setTimeout(() => this.write(file), WRITE_DELAY),
    );
  }

  private write(file: SettingsFile) {
    this.timers.delete(file);
    const text =
      file === "hotkeys.json"
        ? serializeHotkeys(this.hotkeyMap)
        : file === "types.json"
          ? serializeTypes(this.typeMap)
          : serialize(FILES[file], this.values.get(file) as never, this.extras.get(file));
    api.writeConfig(file, text).catch((err) => console.warn(`Settings: could not save .grove/${file}`, err));
  }
}

export const settings = new SettingsStore();
