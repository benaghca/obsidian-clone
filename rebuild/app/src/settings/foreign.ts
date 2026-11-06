// A vault's first Grove settings from Cinder's or Obsidian's. Read once, on
// the first open of a vault whose .grove folder has no settings yet, through
// the read-only read_foreign_config command; nothing here writes to .cinder
// or .obsidian. Only the switch-day settings are mapped: the daily notes
// folder, date format and template, the templates folder (and Obsidian's
// template date and time formats), the attachment folder and the new-note
// folder. Cinder-only features Grove doesn't have (weekly and monthly notes,
// folder templates, Templater) are listed as not imported. Free of the DOM so
// it can be tested on its own.

import { trimSlashes } from "../paths";
import { FILES } from "./schema";

/** One foreign file as read: its text, null when it is missing, or the read's error. */
export type ForeignRead = string | null | { error: string };

export interface ForeignFiles {
  /** .cinder/settings.json */
  cinder: ForeignRead;
  /** .obsidian/daily-notes.json */
  daily: ForeignRead;
  /** .obsidian/templates.json */
  templates: ForeignRead;
  /** .obsidian/app.json */
  app: ForeignRead;
}

/** The read_foreign_config pair behind each file. */
export const FOREIGN_FILES: Record<keyof ForeignFiles, { source: "cinder" | "obsidian"; name: string; path: string }> = {
  cinder: { source: "cinder", name: "settings.json", path: ".cinder/settings.json" },
  daily: { source: "obsidian", name: "daily-notes.json", path: ".obsidian/daily-notes.json" },
  templates: { source: "obsidian", name: "templates.json", path: ".obsidian/templates.json" },
  app: { source: "obsidian", name: "app.json", path: ".obsidian/app.json" },
};

export type ImportFile = "daily-notes.json" | "templates.json" | "app.json";
export const IMPORT_FILES: readonly ImportFile[] = ["daily-notes.json", "templates.json", "app.json"];

export interface ImportPlan {
  /** Where the settings came from; null when the vault has neither Cinder's nor Obsidian's. */
  source: "Cinder" | "Obsidian" | null;
  /** Values to set, by Grove settings file. Only values that differ from Grove's defaults. */
  values: Record<ImportFile, Record<string, unknown>>;
  /** What was imported, for the notice: "Daily notes folder" → "Journal". */
  imported: { label: string; value: string }[];
  /** What the source has that Grove doesn't take (a feature Grove lacks, or a value it refuses), for the notice. */
  notImported: string[];
  /** Files that couldn't be read or aren't JSON objects. When any is listed, nothing is imported. */
  problems: string[];
}

// Cinder's defaults for the keys read here (ui/app/core.js DEFAULTS). Its
// settings.json keeps only what differs from them, so a missing key means
// the default, and a value of the wrong kind falls back to it, as Cinder
// reads the file.
const CINDER_DEFAULTS = {
  newNoteFolder: "",
  dailyFolder: "",
  dailyFormat: "YYYY-MM-DD",
  dailyTemplate: "",
  templatesFolder: "Templates",
  attachFolder: "attachments",
};

/** Cinder settings Grove doesn't have yet, by what the notice calls them, with Cinder's defaults. */
const CINDER_NOT_IMPORTED: [label: string, defaults: Record<string, unknown>][] = [
  ["weekly notes", { weeklyFolder: "", weeklyFormat: "GGGG-[W]WW", weeklyTemplate: "" }],
  ["monthly notes", { monthlyFolder: "", monthlyFormat: "YYYY-MM", monthlyTemplate: "" }],
  ["folder templates", { folderTemplates: "" }],
  ["calendar week start", { weekStart: "monday" }],
  ["drawing format", { drawingFormat: "excalidraw" }],
];

/** Cinder plugins that are Cinder-only features; the rest of the plugins map is left as other settings. */
const CINDER_PLUGINS_NOT_IMPORTED: Record<string, string> = {
  templater: "Templater syntax",
  "periodic-notes": "weekly and monthly notes",
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A folder from the vault root, without slashes at either end or a leading "./". */
const folder = (v: string) => trimSlashes(trimSlashes(v).replace(/^(\.\/)+/, ""));

const LABELS: Record<ImportFile, Record<string, string>> = {
  "daily-notes.json": { folder: "Daily notes folder", format: "Daily note date format", template: "Daily note template" },
  "templates.json": { folder: "Template folder", dateFormat: "Template date format", timeFormat: "Template time format" },
  "app.json": { attachmentFolderPath: "Attachment folder", newFileFolderPath: "New note folder", newFileLocation: "New notes go in", webEmbeds: "Embedded web pages" },
};

/** How a value reads in the notice. */
function shown(key: string, value: unknown): string {
  if (key === "attachmentFolderPath") {
    if (value === "/") return "the vault folder";
    if (value === "./") return "the note's folder";
  }
  if (key === "newFileLocation") return value === "current" ? "the current note's folder" : value === "folder" ? "a set folder" : "the vault folder";
  if (key === "webEmbeds") return value === "click" ? "Click to load" : value === "off" ? "Off" : "Always";
  if (value === "" && (key === "folder" || key === "newFileFolderPath")) return "the vault folder";
  return String(value);
}

function parse(read: ForeignRead, path: string, problems: string[]): Record<string, unknown> | null {
  if (read === null) return null;
  if (typeof read !== "string") {
    problems.push(`${path} couldn't be read (${read.error})`);
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(read);
  } catch {
    problems.push(`${path} isn't valid JSON`);
    return null;
  }
  if (!isObj(value)) {
    problems.push(`${path} isn't a settings object`);
    return null;
  }
  return value;
}

const emptyValues = (): ImportPlan["values"] => ({ "daily-notes.json": {}, "templates.json": {}, "app.json": {} });

/**
 * What to import. Cinder's file wins when it is there: Cinder seeded it from
 * Obsidian's settings on its first open of the vault and kept it since, so
 * Obsidian's files are only read for a vault Cinder never opened. A file that
 * can't be read or isn't a JSON object stops the import (the next open tries
 * again), rather than importing half of what the vault meant.
 */
export function planImport(files: ForeignFiles): ImportPlan {
  const problems: string[] = [];
  const cinder = parse(files.cinder, FOREIGN_FILES.cinder.path, problems);
  if (problems.length) return { source: null, values: emptyValues(), imported: [], notImported: [], problems };
  if (cinder) return finish("Cinder", fromCinder(cinder));
  const daily = parse(files.daily, FOREIGN_FILES.daily.path, problems);
  const templates = parse(files.templates, FOREIGN_FILES.templates.path, problems);
  const app = parse(files.app, FOREIGN_FILES.app.path, problems);
  if (problems.length) return { source: null, values: emptyValues(), imported: [], notImported: [], problems };
  if (!daily && !templates && !app) return { source: null, values: emptyValues(), imported: [], notImported: [], problems };
  return finish("Obsidian", fromObsidian(daily ?? {}, templates ?? {}, app ?? {}));
}

interface Mapped {
  /** Candidate values by Grove file, before they are checked against Grove's schema. */
  values: ImportPlan["values"];
  notImported: string[];
}

function fromCinder(o: Record<string, unknown>): Mapped {
  const get = <K extends keyof typeof CINDER_DEFAULTS>(key: K): string => {
    const v = o[key];
    return typeof v === typeof CINDER_DEFAULTS[key] ? (v as string) : CINDER_DEFAULTS[key];
  };
  const values = emptyValues();
  values["daily-notes.json"].folder = folder(get("dailyFolder"));
  if (get("dailyFormat").trim()) values["daily-notes.json"].format = get("dailyFormat").trim();
  // A note path, not a folder setting: the same slash trimming, so "/Templates/Daily/" still resolves.
  values["daily-notes.json"].template = folder(get("dailyTemplate"));
  values["templates.json"].folder = folder(get("templatesFolder"));
  // Cinder fills {{date}} and {{time}} as YYYY-MM-DD and HH:mm, Grove's defaults, so the formats stay.
  const attach = folder(get("attachFolder"));
  values["app.json"].attachmentFolderPath = attach || "/";
  const newNotes = folder(get("newNoteFolder"));
  if (newNotes) {
    values["app.json"].newFileLocation = "folder";
    values["app.json"].newFileFolderPath = newNotes;
  }

  const notImported: string[] = [];
  const known = new Set<string>(Object.keys(CINDER_DEFAULTS));
  for (const [label, defaults] of CINDER_NOT_IMPORTED) {
    let used = false;
    for (const [key, def] of Object.entries(defaults)) {
      known.add(key);
      if (key in o && JSON.stringify(o[key]) !== JSON.stringify(def)) used = true;
    }
    if (used) notImported.push(label);
  }
  known.add("webEmbeds");
  const embed = o.webEmbeds;
  if (embed === "off" || embed === "click" || embed === "always") values["app.json"].webEmbeds = embed;
  else if (embed !== undefined && embed !== "auto") notImported.push(`Embedded web pages (${JSON.stringify(embed)} isn't a value Grove takes)`);
  const plugins = isObj(o.plugins) ? o.plugins : null;
  if (plugins?.templater === true) notImported.push(CINDER_PLUGINS_NOT_IMPORTED.templater);
  // The plugin turns both on. A weekly or monthly folder only covers that one; the other still needs naming.
  if (plugins?.["periodic-notes"] === true) {
    const weekly = notImported.includes("weekly notes");
    const monthly = notImported.includes("monthly notes");
    if (!weekly && !monthly) notImported.push(CINDER_PLUGINS_NOT_IMPORTED["periodic-notes"]);
    else {
      if (!weekly) notImported.push("weekly notes");
      if (!monthly) notImported.push("monthly notes");
    }
  }
  const otherPlugins = plugins ? Object.keys(plugins).some((id) => !(id in CINDER_PLUGINS_NOT_IMPORTED)) : "plugins" in o;
  const others = Object.keys(o).filter((key) => !known.has(key) && (key !== "plugins" || otherPlugins));
  if (others.length) notImported.push(otherSettings(others, "Cinder"));
  return { values, notImported };
}

function fromObsidian(daily: Record<string, unknown>, templates: Record<string, unknown>, app: Record<string, unknown>): Mapped {
  const values = emptyValues();
  const notImported: string[] = [];
  const others: string[] = [];
  const take = (file: ImportFile, from: Record<string, unknown>, keys: Record<string, (v: string) => string | null>, ignore: string[] = []) => {
    const to = values[file];
    for (const [key, v] of Object.entries(from)) {
      const map = keys[key];
      if (!map) {
        if (!ignore.includes(key)) others.push(key);
        continue;
      }
      // A stale new-note folder (location isn't "folder") is ignored, whatever its type.
      if (typeof v !== "string") {
        if (key === "newFileFolderPath" && app.newFileLocation !== "folder") continue;
        notImported.push(`${LABELS[file][key] ?? key} (${JSON.stringify(v)} isn't a value Grove takes)`);
        continue;
      }
      const mapped = map(v);
      if (mapped !== null) to[key] = mapped;
    }
  };
  const text = (v: string) => v.trim() || null;
  take("daily-notes.json", daily, { folder, format: text, template: folder }, ["autorun"]);
  if (daily.autorun === true) notImported.push("opening today's daily note on startup");
  take("templates.json", templates, { folder, dateFormat: text, timeFormat: text });
  take("app.json", app, {
    // Grove reads Obsidian's attachmentFolderPath as is, "./" folders included.
    attachmentFolderPath: (v) => v.trim() || "/",
    newFileLocation: (v) => v,
    // Obsidian keeps the folder after "New notes go in" moves off it; it only counts with "folder".
    newFileFolderPath: (v) => (app.newFileLocation === "folder" ? folder(v) : null),
  });
  if (others.length) notImported.push(otherSettings(others, "Obsidian"));
  return { values, notImported };
}

/** "8 other Cinder settings (theme, vim, hotkeys, …)". */
function otherSettings(keys: string[], source: string): string {
  const names = keys.slice(0, 5).join(", ") + (keys.length > 5 ? ", …" : "");
  return `${keys.length} other ${source} setting${keys.length === 1 ? "" : "s"} (${names})`;
}

/** Check each candidate against Grove's schema; keep what is valid and differs from Grove's default. */
function finish(source: "Cinder" | "Obsidian", mapped: Mapped): ImportPlan {
  const values = emptyValues();
  const imported: ImportPlan["imported"] = [];
  const notImported: string[] = [];
  for (const file of IMPORT_FILES) {
    const spec = FILES[file] as Record<string, { default: unknown; valid(v: unknown): boolean }>;
    for (const [key, value] of Object.entries(mapped.values[file])) {
      const field = spec[key];
      const label = LABELS[file][key] ?? key;
      if (!field?.valid(value)) {
        notImported.push(`${label} (${JSON.stringify(value)} isn't a value Grove takes)`);
        continue;
      }
      if (JSON.stringify(value) === JSON.stringify(field.default)) continue;
      // "folder" with no usable folder is the vault folder, which is Grove's default location.
      // An invalid path is named on its own line; a missing one is named here.
      if (key === "newFileLocation" && value === "folder") {
        const path = mapped.values[file].newFileFolderPath;
        const pathField = spec.newFileFolderPath;
        const pathOk = !!pathField?.valid(path) && JSON.stringify(path) !== JSON.stringify(pathField.default);
        if (!pathOk) {
          if (path === undefined && !mapped.notImported.some((line) => line.startsWith("New note folder"))) {
            notImported.push(`${label} (no folder was set)`);
          }
          continue;
        }
        values[file][key] = value;
        continue;
      }
      values[file][key] = value;
      imported.push({ label, value: shown(key, value) });
    }
  }
  return { source, values, imported, notImported: [...notImported, ...mapped.notImported], problems: [] };
}

/** The notice's lines, or null when there is nothing to say (no foreign settings at all). */
export function importMessage(plan: ImportPlan): string[] | null {
  if (plan.problems.length) {
    return ["Grove didn't import this vault's settings:", ...plan.problems.map((p) => `• ${p}`), "Fix the file and open the vault again to import them."];
  }
  if (!plan.source || (!plan.imported.length && !plan.notImported.length)) return null;
  const lines = [plan.imported.length ? `Imported settings from ${plan.source}:` : `Nothing imported from ${plan.source}.`];
  for (const { label, value } of plan.imported) lines.push(`• ${label}: ${value}`);
  if (plan.notImported.length) lines.push(`Not imported: ${plan.notImported.join("; ")}.`);
  return lines;
}
