import type { FileEntry } from "../api";
import type { Property } from "../editor/frontmatter";
import { compareNames, isNoteFile, noteName, parentDir } from "../paths";
import { parseDate } from "./dates";
import { expression, isFormulaError, testExpression, type Context, type Expression, type Value } from "./expression";
import { mapping, readYaml, type Yaml } from "./yaml";
export interface Row { file: FileEntry; props: Property[]; tags: string[]; hasLink(link: string): boolean }

/** Files a Base lists: notes, `.md` in any case, that are not excluded. */
export function baseNoteFiles(files: readonly FileEntry[], excluded: (path: string) => boolean): FileEntry[] {
  return files.filter((f) => !f.is_dir && isNoteFile(f.path) && !excluded(f.path));
}
const FILE_LABELS: Record<string, string> = {"file.name":"file name", "file.ctime":"created time", "file.mtime":"modified time", "file.ext":"file extension", "file.folder":"folder", "file.path":"file path", "file.size":"file size", "file.tags":"file tags"};
export const propertyId = (key: string) => /^(file|formula)\./.test(key) ? key : `note.${noteKey(key)}`;
export const noteKey = (key: string) => key.replace(/^note\./, "");
export const ROW_HEIGHTS:Record<string,number> = {"":30,medium:60,tall:120,extra:240};
const canonicalKeys = new Map<string, string>();
const canonical = (key: string) => {
  let out = canonicalKeys.get(key);
  if (out === undefined) {
    if (canonicalKeys.size > 10_000) canonicalKeys.clear();
    canonicalKeys.set(key, (out = /^(file|formula)\./.test(key) ? key : `note.${noteKey(key)}`));
  }
  return out;
};
/** One file fact of a row, worked out only when a filter, formula or column asks for it. */
function fileFact(row: Row, key: string): Value {
  const f = row.file;
  switch (key) {
    case "file.name": return noteName(f.path);
    case "file.path": return f.path;
    case "file.folder": return parentDir(f.path);
    case "file.ext": return "md";
    case "file.tags": return row.tags;
    case "file.mtime": return new Date(f.mtime_ms).toISOString();
    case "file.ctime": return new Date(f.ctime_ms).toISOString();
    case "file.size": return f.size;
    default: return null;
  }
}
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/;
interface SortKey { missing: boolean; value: Value; time?: number; dateLike: boolean; text: string }
function sortKey(value: Value): SortKey {
  const missing = value === null || value === "" || Array.isArray(value) && !value.length;
  const dateLike = typeof value === "string" && DATE_LIKE.test(value);
  return { missing, value, dateLike, time: dateLike ? parseDate(value as string)?.time : undefined, text: String(value ?? "") };
}
/** The table's order between two values that are both filled: numbers, ISO dates, then text by locale. */
function compareKeys(a: SortKey, b: SortKey): number {
  const x = a.value, y = b.value;
  if (typeof x === "number" && typeof y === "number") return x - y;
  if (a.dateLike && b.dateLike) return a.time !== undefined && b.time !== undefined ? a.time - b.time : x! < y! ? -1 : x! > y! ? 1 : 0;
  return compareNames(a.text, b.text);
}
export function baseModel(source: string, viewIndex = 0) {
  const root = readYaml(source), notices = new Set<string>();
  if (root.views != null && !Array.isArray(root.views)) throw Error("views must be a list");
  const views = Array.isArray(root.views) && root.views.length ? root.views : [{type:"table",name:"View"}];
  viewIndex = Math.max(0, Math.min(viewIndex, views.length - 1));
  const first = views[viewIndex];
  if (first != null && (typeof first !== "object" || Array.isArray(first))) throw Error("A view must be a mapping");
  const view = mapping(first);
  if (view.type != null && view.type !== "table" && view.type !== "cards") throw Error(`Unsupported view type: ${String(view.type)}`);
  const compile = (source: Yaml | undefined): Expression => {
    if (typeof source !== "string") { notices.add(`Unsupported expression: ${String(source)}`); return () => null; }
    try { return expression(source); } catch { notices.add(`Unsupported expression: ${source}`); return () => null; }
  };
  const tree = (filter: Yaml | undefined): Expression => {
    if (filter == null) return () => true;
    if (typeof filter === "string") return compile(filter);
    const entries = Object.entries(mapping(filter));
    if (entries.length !== 1 || !["and", "or", "not"].includes(entries[0][0]) || !Array.isArray(entries[0][1])) {
      notices.add("Unsupported filter tree"); return () => false;
    }
    const [op, children] = entries[0], nodes = (children as Yaml[]).map(tree);
    // A failed child fails the whole tree (an error value is truthy, and "not" must not turn it into a match).
    return c => {
      for (const n of nodes) {
        const v = n(c);
        if (isFormulaError(v)) return v;
        if (op === "and" ? !v : !!v) return op === "or";
      }
      return op !== "or";
    };
  };
  const global = tree(root.filters), local = tree(view.filters);
  const formulas = new Map(Object.entries(mapping(root.formulas)).map(([k, v]) => [k, compile(v)]));
  if (view.order != null && (!Array.isArray(view.order) || !view.order.every(k => typeof k === "string"))) throw Error("order must be a list of property names");
  const columns = (Array.isArray(view.order) ? view.order : ["file.name"]) as string[];
  if (view.sort != null && !Array.isArray(view.sort)) throw Error("sort must be a list");
  const sorts = ((view.sort ?? []) as Yaml[]).map(s => {
    const config = mapping(s);
    if (typeof config.property !== "string" || !["ASC", "DESC"].includes(String(config.direction ?? "ASC"))) throw Error("Invalid sort property or direction");
    return { property: config.property, direction: config.direction === "DESC" ? -1 : 1 };
  });
  if (view.limit != null && (typeof view.limit !== "number" || !Number.isInteger(view.limit) || view.limit < 0)) throw Error("limit must be a non-negative integer");
  const context = (row: Row): Context => {
    const active = new Set<string>(), values = new Map<string, Value>();
    const get = (key: string): Value => {
      key = canonical(key);
      if (values.has(key)) return values.get(key)!;
      let value: Value = null;
      if (key.startsWith("formula.")) {
        if (active.has(key)) { notices.add(`Circular formula: ${key}`); return null; }
        active.add(key);
        value = formulas.get(key.slice(8))?.(ctx) ?? null;
        active.delete(key);
      } else if (key.startsWith("file.")) {
        value = fileFact(row, key);
      } else {
        const p = row.props.find(p => p.key === noteKey(key));
        if (p && p.type !== "unknown") value = p.type === "number" && p.value !== "" ? Number(p.value) : p.value;
      }
      values.set(key, value); return value;
    };
    const ctx: Context = { get, hasLink: row.hasLink, hasTag: tag => { tag = tag.replace(/^#/, ""); return row.tags.some(t => t.replace(/^#/, "") === tag || t.replace(/^#/, "").startsWith(tag + "/")); } };
    return ctx;
  };
  const label = (key: string) => {
    const config = mapping(mapping(root.properties)[canonical(key)] ?? mapping(root.properties)[key] ?? mapping(root.properties)[noteKey(key)]);
    return typeof config.displayName === "string" ? config.displayName : (key.startsWith("file.") ? FILE_LABELS[key] : undefined) ?? key.replace(/^(note|formula)\./, "");
  };
  function select(rows: Row[], unlimited = false) {
    const found = rows.map(row => ({ row, context: context(row) })).filter(r => testExpression(global, r.context) && testExpression(local, r.context));
    // Each row's sort values are read and parsed once, not on every comparison.
    const keyed = found.map(r => ({ r, keys: sorts.map(sort => sortKey(r.context.get(sort.property))), name: noteName(r.row.file.path) }));
    keyed.sort((a, b) => {
      for (let i = 0; i < sorts.length; i++) {
        const x = a.keys[i], y = b.keys[i];
        // Empties go last in either direction.
        if (x.missing !== y.missing) return x.missing ? 1 : -1;
        const diff = compareKeys(x, y);
        if (diff) return diff * sorts[i].direction;
      }
      return compareNames(a.name, b.name) || compareNames(a.r.row.file.path, b.r.row.file.path);
    });
    const sorted = keyed.map(k => k.r);
    return !unlimited && typeof view.limit === "number" ? sorted.slice(0, view.limit) : sorted;
  }
  const type: "table" | "cards" = view.type === "cards" ? "cards" : "table";
  const cardSize = typeof view.cardSize === "number" && Number.isFinite(view.cardSize) ? Math.max(80, Math.min(800, Math.round(view.cardSize))) : ({ small: 160, medium: 220, large: 320 } as Record<string, number>)[String(view.cardSize ?? "")] ?? 220;
  const rawImage = view.image ?? view.cover ?? view.imageProperty, image = typeof rawImage === "string" && rawImage.trim() ? rawImage.trim() : null;
  const imageFit: "cover" | "contain" = (view.imageFit ?? view.coverFit) === "contain" ? "contain" : "cover";
  const rawRatio = view.imageAspectRatio ?? view.aspectRatio ?? view.coverAspectRatio, imageAspectRatio = typeof rawRatio === "number" && Number.isFinite(rawRatio) && rawRatio > 0 ? Math.max(0.2, Math.min(3, rawRatio)) : 0.5;
  return { type, cardSize, image, imageFit, imageAspectRatio, rowHeight:ROW_HEIGHTS[String(view.rowHeight??"")]??30, sizes: mapping(view.columnSize), root, view, views, viewIndex, results: 0, total: 0, filtered: root.filters != null || view.filters != null, formulaNames: [...formulas.keys()].map(k => `formula.${k}`), name: typeof view.name === "string" ? view.name : "View", columns, sorts, label, select, notices };
}
