// What Grove's settings are, their defaults, and how values read from disk
// are checked. Settings live per vault in its .grove folder (Grove's
// .obsidian), one JSON file per area as in Obsidian: app.json,
// appearance.json, hotkeys.json, core-plugins.json and one file per core
// plugin with options. Each file keeps only what differs from the defaults,
// so it reads as the list of things the owner changed. Free of the DOM so it
// can be tested on its own.

type Check = (v: unknown) => boolean;

interface Field<T> {
  default: T;
  valid: Check;
}

const bool: Check = (v) => typeof v === "boolean";
const oneOf =
  (...values: readonly unknown[]): Check =>
  (v) =>
    values.includes(v);
const num =
  (min: number, max: number, step = 0): Check =>
  (v) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max && (!step || Math.abs(v / step - Math.round(v / step)) < 1e-9);
const text =
  (max = 500): Check =>
  (v) =>
    typeof v === "string" && v.length <= max && !v.includes("\n");
const textList: Check = (v) => Array.isArray(v) && v.length <= 500 && v.every((x) => typeof x === "string" && x.length <= 500);
/** A font family name: letters, digits, spaces and a little punctuation, so it can go into CSS as is. */
export const isFontName = (v: unknown): v is string => typeof v === "string" && v.length <= 80 && /^[\p{L}\p{N} _.\-]*$/u.test(v);
/** "#rrggbb", or "" for Grove's own accent. */
export const isColor = (v: unknown): v is string => typeof v === "string" && (v === "" || /^#[0-9a-f]{6}$/i.test(v));

const field = <T>(value: T, valid: Check): Field<T> => ({ default: value, valid });

export const APP = {
  // Editor
  defaultViewMode: field<"source" | "preview">("source", oneOf("source", "preview")),
  livePreview: field(true, bool),
  showInlineTitle: field(true, bool),
  readableLineLength: field(true, bool),
  showLineNumber: field(false, bool),
  foldHeading: field(true, bool),
  foldIndent: field(true, bool),
  spellcheck: field(true, bool),
  autoPairBrackets: field(true, bool),
  autoPairMarkdown: field(true, bool),
  smartIndentList: field(true, bool),
  useTab: field(true, bool),
  tabSize: field(4, num(1, 8, 1)),
  // Files and links
  newFileLocation: field<"root" | "current" | "folder">("root", oneOf("root", "current", "folder")),
  newFileFolderPath: field("", text()),
  newLinkFormat: field<"shortest" | "relative" | "absolute">("shortest", oneOf("shortest", "relative", "absolute")),
  useMarkdownLinks: field(false, bool),
  alwaysUpdateLinks: field(false, bool),
  promptDelete: field(true, bool),
  trashOption: field<"local" | "none">("local", oneOf("local", "none")),
  userIgnoreFilters: field<string[]>([], textList),
};

export const APPEARANCE = {
  theme: field<"light" | "dark" | "system">("system", oneOf("light", "dark", "system")),
  accentColor: field("", isColor),
  interfaceFontFamily: field("", isFontName),
  textFontFamily: field("", isFontName),
  monospaceFontFamily: field("", isFontName),
  baseFontSize: field(16, num(10, 30, 1)),
  /** Obsidian's zoom level: the zoom factor is 1.2 to this power (-2.5 is 63%, 3 is 173%). */
  zoomLevel: field(0, num(-2.5, 3, 0.5)),
  showRibbon: field(true, bool),
  showViewHeader: field(true, bool),
};

/** Grove's built-in features that can be turned off (Obsidian's core plugin ids). */
export const CORE_PLUGINS = {
  backlink: field(true, bool),
  bookmarks: field(true, bool),
  "command-palette": field(true, bool),
  "daily-notes": field(true, bool),
  "note-composer": field(true, bool),
  "outgoing-link": field(true, bool),
  outline: field(true, bool),
  "random-note": field(true, bool),
  switcher: field(true, bool),
  "tag-pane": field(true, bool),
  templates: field(true, bool),
  "word-count": field(true, bool),
};

export const DAILY_NOTES = {
  format: field("YYYY-MM-DD", text(100)),
  folder: field("", text()),
  template: field("", text()),
};

export const TEMPLATES = {
  folder: field("", text()),
  dateFormat: field("YYYY-MM-DD", text(100)),
  timeFormat: field("HH:mm", text(100)),
};

export const BACKLINK = {
  backlinkInDocument: field(false, bool),
};

export const NOTE_COMPOSER = {
  askBeforeMerging: field(true, bool),
};

type Spec = Record<string, Field<unknown>>;
export type Values<S extends Spec> = { -readonly [K in keyof S]: S[K]["default"] };

/** Every settings file but hotkeys.json (which is a map of its own), by file name. */
export const FILES = {
  "app.json": APP,
  "appearance.json": APPEARANCE,
  "core-plugins.json": CORE_PLUGINS,
  "daily-notes.json": DAILY_NOTES,
  "templates.json": TEMPLATES,
  "backlink.json": BACKLINK,
  "note-composer.json": NOTE_COMPOSER,
} satisfies Record<string, Spec>;

export type FileName = keyof typeof FILES;
export type SettingsOf<F extends FileName> = Values<(typeof FILES)[F]>;
export type PluginId = keyof typeof CORE_PLUGINS;

export function defaults<S extends Spec>(spec: S): Values<S> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(spec)) out[k] = structuredClone(f.default);
  return out as Values<S>;
}

/**
 * Settings from a file's parsed JSON: each known key that holds a valid
 * value is taken, anything missing, unknown or invalid falls back to its
 * default quietly. Keys Grove doesn't know are handed back separately so a
 * later write keeps them.
 */
export function sanitize<S extends Spec>(spec: S, raw: unknown): { values: Values<S>; extra: Record<string, unknown> } {
  const values = defaults(spec) as Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      const f = spec[k];
      if (!f) extra[k] = v;
      else if (f.valid(v)) values[k] = structuredClone(v);
    }
  }
  return { values: values as Values<S>, extra };
}

/** Whether a value is acceptable for a key (what the settings UI may write). */
export function isValid<S extends Spec>(spec: S, key: keyof S, value: unknown): boolean {
  return spec[key].valid(value);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A file's JSON: the values that differ from the defaults, plus keys Grove doesn't know. Two-space indented. */
export function serialize<S extends Spec>(spec: S, values: Values<S>, extra: Record<string, unknown> = {}): string {
  const out: Record<string, unknown> = { ...extra };
  for (const [k, f] of Object.entries(spec)) {
    const v = (values as Record<string, unknown>)[k];
    if (!same(v, f.default)) out[k] = v;
  }
  return JSON.stringify(out, null, 2) + "\n";
}

// ----- hotkeys.json -----

/** A hotkey as Obsidian writes it in hotkeys.json: { "modifiers": ["Mod", "Shift"], "key": "P" }. */
export interface StoredHotkey {
  modifiers: ("Mod" | "Alt" | "Shift" | "Ctrl" | "Meta")[];
  key: string;
}

const MODIFIERS = ["Mod", "Alt", "Shift", "Ctrl", "Meta"];

const isStoredHotkey = (v: unknown): v is StoredHotkey =>
  !!v &&
  typeof v === "object" &&
  Array.isArray((v as StoredHotkey).modifiers) &&
  (v as StoredHotkey).modifiers.every((m) => MODIFIERS.includes(m)) &&
  typeof (v as StoredHotkey).key === "string" &&
  (v as StoredHotkey).key.length > 0 &&
  (v as StoredHotkey).key.length <= 20;

/**
 * Custom hotkeys by command id. A command listed with an empty array has
 * had all its hotkeys removed; a command not listed keeps its defaults.
 * Invalid entries are dropped quietly (the command keeps its defaults).
 */
export function sanitizeHotkeys(raw: unknown): Record<string, StoredHotkey[]> {
  const out: Record<string, StoredHotkey[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, list] of Object.entries(raw)) {
    if (!Array.isArray(list) || !list.every(isStoredHotkey) || list.length > 10) continue;
    out[id] = list.map((hk) => ({ modifiers: [...hk.modifiers], key: hk.key }));
  }
  return out;
}

export function serializeHotkeys(map: Record<string, StoredHotkey[]>): string {
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify(sorted, null, 2) + "\n";
}
