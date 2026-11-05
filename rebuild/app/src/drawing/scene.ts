// The `.excalidraw` file model: JSON `{type: "excalidraw", version: 2, source,
// elements, appState, files}`. The parsed document is kept as it was read, and
// a typed, defaulted view of each element sits beside it for drawing. Edits go
// through `updateElement`/`addElement`/`deleteElement`, which patch the raw
// records in place, so unknown keys, unknown element types and deleted
// elements stay in the file in their order. A save with no edits writes the
// bytes that were read; a save after edits re-serializes in the file's own
// layout (indent, line ending, final newline), which for files written by
// Excalidraw or Cinder (`JSON.stringify(doc, null, 2)`) leaves every
// untouched element byte-identical.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export type FillStyle = "solid" | "hachure" | "cross-hatch" | "zigzag";
export type StrokeStyle = "solid" | "dashed" | "dotted";
export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";
export type Point = [number, number];

export interface Roundness { type: number; value?: number }
export interface BoundElement { id: string; type: string }
export interface Binding { elementId: string; focus: number; gap: number }

/** Fields every element has, defaulted the way Excalidraw restores them. Read-only: edit through `updateElement`. */
export interface BaseElement {
  /** The record in the file. */
  readonly raw: JsonObject;
  id: string;
  /** The stored type; `draw` (an old name for `line`) reads as `line`. */
  type: string;
  /** False for a type Grove doesn't know; it is kept in the file and not drawn. */
  known: boolean;
  /** Position of the record in the file's `elements` array (not Excalidraw's own `index` key). */
  slot: number;
  x: number; y: number; width: number; height: number; angle: number;
  strokeColor: string; backgroundColor: string;
  fillStyle: FillStyle; strokeWidth: number; strokeStyle: StrokeStyle;
  roughness: number; opacity: number; seed: number;
  version: number; versionNonce: number; updated: number;
  isDeleted: boolean; locked: boolean;
  groupIds: string[]; frameId: string | null;
  roundness: Roundness | null;
  boundElements: BoundElement[];
  link: string | null;
  customData: JsonObject | null;
}
export interface ShapeElement extends BaseElement { type: "rectangle" | "diamond" | "ellipse" }
export interface LinearElement extends BaseElement {
  type: "line" | "arrow";
  points: Point[];
  startBinding: Binding | null; endBinding: Binding | null;
  startArrowhead: string | null; endArrowhead: string | null;
  elbowed: boolean;
}
export interface FreedrawElement extends BaseElement {
  type: "freedraw";
  points: Point[]; pressures: number[]; simulatePressure: boolean;
}
export interface TextElement extends BaseElement {
  type: "text";
  text: string; originalText: string;
  fontSize: number; fontFamily: number; lineHeight: number;
  textAlign: TextAlign; verticalAlign: VerticalAlign;
  containerId: string | null; autoResize: boolean;
}
export interface ImageElement extends BaseElement {
  type: "image";
  fileId: string | null; status: string; scale: [number, number];
  crop: JsonObject | null;
}
export interface FrameElement extends BaseElement { type: "frame" | "magicframe"; name: string | null }
export interface UnknownElement extends BaseElement { known: false }
export type DrawingElement = Readonly<ShapeElement | LinearElement | FreedrawElement | TextElement | ImageElement | FrameElement | UnknownElement>;

export interface DrawingFile { id: string; mimeType: string; dataURL: string; created: number | null }
export interface AppState { viewBackgroundColor: string; gridSize: number | null }

/** How the file was laid out, so a save writes it back the same way. */
export interface FileStyle { indent: string; eol: "\n" | "\r\n"; finalNewline: boolean; bom: boolean }

export interface Scene {
  /** The text this scene was parsed from; written back as-is while `dirty` is false. */
  source: string;
  /** The parsed document, edited in place. */
  data: JsonObject;
  /** One entry per element record with a string `id` and `type`, in file order, deleted ones included. */
  elements: DrawingElement[];
  appState: AppState;
  files: Map<string, DrawingFile>;
  style: FileStyle;
  dirty: boolean;
}

export type ParseResult = { ok: true; scene: Scene } | { ok: false; error: string };

/** Where edits get their timestamps and nonces; tests pass fixed ones. */
export interface Stamp { now?: () => number; random?: () => number }

const KNOWN = new Set(["rectangle", "diamond", "ellipse", "line", "arrow", "freedraw", "text", "image", "frame", "magicframe"]);
const FILL = new Set(["solid", "hachure", "cross-hatch", "zigzag"]);
const STROKE = new Set(["solid", "dashed", "dotted"]);
const ALIGN = new Set(["left", "center", "right"]);
const VALIGN = new Set(["top", "middle", "bottom"]);

// The key order of a fresh element, used to place a key an edit adds.
const BASE_KEYS = ["id", "type", "x", "y", "width", "height", "angle", "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "groupIds", "frameId", "roundness", "seed", "version", "versionNonce", "isDeleted", "boundElements", "updated", "link", "locked"];
const TYPE_KEYS: Record<string, string[]> = {
  text: ["text", "fontSize", "fontFamily", "textAlign", "verticalAlign", "containerId", "originalText", "autoResize", "lineHeight"],
  line: ["points", "lastCommittedPoint", "startBinding", "endBinding", "startArrowhead", "endArrowhead"],
  arrow: ["points", "lastCommittedPoint", "startBinding", "endBinding", "startArrowhead", "endArrowhead", "elbowed"],
  freedraw: ["points", "pressures", "simulatePressure", "lastCommittedPoint"],
  image: ["fileId", "status", "scale", "crop"],
  frame: ["name"],
  magicframe: ["name"],
};

const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => typeof v === "number" && Number.isFinite(v) ? v : d;
const str = (v: unknown, d: string) => typeof v === "string" ? v : d;
const strOrNull = (v: unknown) => typeof v === "string" ? v : null;
const bool = (v: unknown, d: boolean) => typeof v === "boolean" ? v : d;
const oneOf = <T extends string>(v: unknown, set: Set<string>, d: T) => (typeof v === "string" && set.has(v) ? v : d) as T;

function points(v: unknown): Point[] {
  if (!Array.isArray(v)) return [[0, 0]];
  // The common case: every point is already a pair of numbers, so share the array.
  let clean = true;
  for (const p of v) if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) { clean = false; break; }
  if (clean) return v.length ? v as Point[] : [[0, 0]];
  const out: Point[] = [];
  for (const p of v) if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push([p[0] as number, p[1] as number]);
  return out.length ? out : [[0, 0]];
}

function binding(v: unknown): Binding | null {
  if (!isObject(v) || typeof v.elementId !== "string") return null;
  // Share a well-formed record rather than copy it; views are read-only.
  if (Number.isFinite(v.focus) && Number.isFinite(v.gap)) return v as unknown as Binding;
  return { elementId: v.elementId, focus: num(v.focus, 0), gap: num(v.gap, 0) };
}

function roundness(raw: JsonObject, type: string): Roundness | null {
  const r = raw.roundness;
  if (isObject(r)) {
    if (Number.isFinite(r.type) && (r.value === undefined || Number.isFinite(r.value))) return r as unknown as Roundness;
    return Number.isFinite(r.value) ? { type: num(r.type, 2), value: r.value as number } : { type: num(r.type, 2) };
  }
  // Files from before `roundness` say `strokeSharpness: "round"`.
  if (r === undefined && raw.strokeSharpness === "round") return { type: type === "rectangle" || type === "image" ? 3 : 2 };
  return null;
}

function boundElements(raw: JsonObject): BoundElement[] {
  const b = raw.boundElements;
  if (Array.isArray(b)) {
    if (b.every(e => isObject(e) && typeof e.id === "string" && typeof e.type === "string")) return b as unknown as BoundElement[];
    const out: BoundElement[] = [];
    for (const e of b) if (isObject(e) && typeof e.id === "string") out.push({ id: e.id, type: str(e.type, "arrow") });
    return out;
  }
  // Older files list only ids, and only arrows could bind.
  if (b === undefined && Array.isArray(raw.boundElementIds)) return raw.boundElementIds.filter((id): id is string => typeof id === "string").map(id => ({ id, type: "arrow" }));
  return [];
}

const textOf = (v: unknown) => typeof v === "string" ? v : v == null ? "" : String(v);
const finiteList = (v: unknown) => Array.isArray(v) && v.every(p => Number.isFinite(p)) ? v as number[] : [];
const pair = (v: unknown): [number, number] => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) ? [v[0] as number, v[1] as number] : [1, 1];
const stringList = (v: unknown) => Array.isArray(v) && v.every(g => typeof g === "string") ? v as string[] : [];

// A read-only view over one raw record. Opening a drawing makes one of these
// per element and nothing more; each field is read from the record, with its
// default, when something asks for it, and lists are worked out once. Fields
// of other types read as their defaults. Read fields by name: the view has
// no own keys to spread or compare.
class ElementView {
  readonly raw: JsonObject;
  readonly slot: number;
  readonly id: string;
  readonly type: string;
  readonly known: boolean;
  #points?: Point[]; #bound?: BoundElement[]; #groups?: string[]; #roundness?: Roundness | null;
  #start?: Binding | null; #end?: Binding | null; #pressures?: number[]; #scale?: [number, number];
  constructor(raw: JsonObject, slot: number, id: string, type: string) {
    this.raw = raw;
    this.slot = slot;
    this.id = id;
    this.type = type === "draw" ? "line" : type;
    this.known = KNOWN.has(this.type);
  }
  get x() { return num(this.raw.x, 0); }
  get y() { return num(this.raw.y, 0); }
  get width() { return num(this.raw.width, 0); }
  get height() { return num(this.raw.height, 0); }
  get angle() { return num(this.raw.angle, 0); }
  get strokeColor() { return str(this.raw.strokeColor, "") || "#1e1e1e"; }
  get backgroundColor() { return str(this.raw.backgroundColor, "") || "transparent"; }
  get fillStyle() { return oneOf<FillStyle>(this.raw.fillStyle, FILL, "solid"); }
  get strokeWidth() { return num(this.raw.strokeWidth, 2); }
  get strokeStyle() { return oneOf<StrokeStyle>(this.raw.strokeStyle, STROKE, "solid"); }
  get roughness() { return num(this.raw.roughness, 1); }
  get opacity() { return Math.min(100, Math.max(0, num(this.raw.opacity, 100))); }
  get seed() { return num(this.raw.seed, 1); }
  get version() { return num(this.raw.version, 1); }
  get versionNonce() { return num(this.raw.versionNonce, 0); }
  get updated() { return num(this.raw.updated, 0); }
  get isDeleted() { return this.raw.isDeleted === true; }
  get locked() { return this.raw.locked === true; }
  get groupIds() { return this.#groups ??= stringList(this.raw.groupIds); }
  get frameId() { return strOrNull(this.raw.frameId); }
  get roundness() { return this.#roundness !== undefined ? this.#roundness : this.#roundness = roundness(this.raw, this.type); }
  get boundElements() { return this.#bound ??= boundElements(this.raw); }
  get link() { return strOrNull(this.raw.link); }
  get customData() { return isObject(this.raw.customData) ? this.raw.customData : null; }
  // line, arrow, freedraw
  get points() { return this.#points ??= points(this.raw.points); }
  get startBinding() { return this.#start !== undefined ? this.#start : this.#start = binding(this.raw.startBinding); }
  get endBinding() { return this.#end !== undefined ? this.#end : this.#end = binding(this.raw.endBinding); }
  get startArrowhead() { return strOrNull(this.raw.startArrowhead); }
  // An arrow saved before arrowheads were stored has one at its end.
  get endArrowhead() { return this.raw.endArrowhead === undefined && this.type === "arrow" ? "arrow" : strOrNull(this.raw.endArrowhead); }
  get elbowed() { return this.raw.elbowed === true; }
  get pressures() { return this.#pressures ??= finiteList(this.raw.pressures); }
  get simulatePressure() { return bool(this.raw.simulatePressure, this.pressures.length === 0); }
  // text
  get text() { return textOf(this.raw.text); }
  get originalText() { return str(this.raw.originalText, this.text); }
  get fontSize() { return num(this.raw.fontSize, 20); }
  get fontFamily() { return num(this.raw.fontFamily, 1); }
  get lineHeight() { return num(this.raw.lineHeight, 1.25); }
  get textAlign() { return oneOf<TextAlign>(this.raw.textAlign, ALIGN, "left"); }
  get verticalAlign() { return oneOf<VerticalAlign>(this.raw.verticalAlign, VALIGN, "top"); }
  get containerId() { return strOrNull(this.raw.containerId); }
  get autoResize() { return bool(this.raw.autoResize, true); }
  // image
  get fileId() { return strOrNull(this.raw.fileId); }
  get status() { return str(this.raw.status, "saved"); }
  get scale() { return this.#scale ??= pair(this.raw.scale); }
  get crop() { return isObject(this.raw.crop) ? this.raw.crop : null; }
  // frame
  get name() { return strOrNull(this.raw.name); }
}

/** The typed view of one raw element record, or null if it has no string id and type. */
export function viewElement(raw: unknown, slot: number): DrawingElement | null {
  if (!isObject(raw) || typeof raw.id !== "string" || typeof raw.type !== "string") return null;
  return new ElementView(raw, slot, raw.id, raw.type) as unknown as DrawingElement;
}

function viewFiles(v: unknown) {
  const files = new Map<string, DrawingFile>();
  if (!isObject(v)) return files;
  for (const id in v) {
    const f = v[id];
    if (isObject(f) && typeof f.dataURL === "string" && typeof f.mimeType === "string") files.set(id, { id, mimeType: f.mimeType, dataURL: f.dataURL, created: typeof f.created === "number" ? f.created : null });
  }
  return files;
}

function viewAppState(v: unknown): AppState {
  const a = isObject(v) ? v : {};
  return { viewBackgroundColor: str(a.viewBackgroundColor, "#ffffff") || "#ffffff", gridSize: typeof a.gridSize === "number" && a.gridSize > 0 ? a.gridSize : null };
}

const INDENT_RE = /\n([ \t]*)\S/g;

function detectStyle(body: string, bom: boolean): FileStyle {
  const nl = body.indexOf("\n");
  if (nl < 0) return { indent: "", eol: "\n", finalNewline: false, bom };
  const eol = nl > 0 && body.charCodeAt(nl - 1) === 13 ? "\r\n" : "\n";
  const finalNewline = body.charCodeAt(body.length - 1) === 10;
  // Nothing after the only newline means a one-line file with a final newline.
  INDENT_RE.lastIndex = nl;
  const m = INDENT_RE.exec(body);
  if (!m) return { indent: "", eol, finalNewline, bom };
  return { indent: m[1] || "  ", eol, finalNewline, bom };
}

const DEFAULT_STYLE: FileStyle = { indent: "  ", eol: "\n", finalNewline: true, bom: false };

/** The text of a new, empty drawing. */
export function emptyDrawing(source = "grove"): string {
  return JSON.stringify({ type: "excalidraw", version: 2, source, elements: [], appState: { gridSize: null, viewBackgroundColor: "#ffffff" }, files: {} }, null, 2) + "\n";
}

/** Whether `text` looks like a drawing Grove may open and save. */
export function isDrawingText(text: string): boolean { return parseScene(text).ok; }

/**
 * Parse a `.excalidraw` file. A blank file opens as an empty drawing. Anything
 * that isn't Excalidraw JSON (bad JSON, not an object, another `type`, or
 * `elements` that isn't an array) is refused: there is no scene to save, so
 * the file can't be overwritten.
 */
export function parseScene(text: string): ParseResult {
  const bom = text.charCodeAt(0) === 0xfeff;
  const body = bom ? text.slice(1) : text;
  // Kept clean, so saving without an edit leaves the blank file blank.
  if (!/\S/.test(body)) {
    const data = JSON.parse(emptyDrawing()) as JsonObject;
    return { ok: true, scene: { source: text, data, elements: [], appState: viewAppState(data.appState), files: new Map(), style: { ...DEFAULT_STYLE, bom }, dirty: false } };
  }
  let data: unknown;
  try { data = JSON.parse(body); } catch { return { ok: false, error: "This file isn’t valid JSON, so it can’t be opened as a drawing." }; }
  if (!isObject(data)) return { ok: false, error: "This file isn’t an Excalidraw drawing." };
  if (data.type !== undefined && data.type !== "excalidraw") return { ok: false, error: `This file isn’t an Excalidraw drawing (its type is ${JSON.stringify(data.type)}).` };
  if (data.elements !== undefined && !Array.isArray(data.elements)) return { ok: false, error: "This drawing’s elements aren’t a list, so it can’t be opened." };
  // Without a type, only a list of elements makes it a drawing.
  if (data.type === undefined && !Array.isArray(data.elements)) return { ok: false, error: "This file isn’t an Excalidraw drawing." };
  const raw = (data.elements ?? []) as Json[];
  const elements: DrawingElement[] = [];
  for (let i = 0; i < raw.length; i++) { const el = viewElement(raw[i], i); if (el) elements.push(el); }
  return { ok: true, scene: { source: text, data, elements, appState: viewAppState(data.appState), files: viewFiles(data.files), style: detectStyle(body, bom), dirty: false } };
}

/** The document as text, laid out like the file it came from. */
export function stringifyScene(scene: Scene): string {
  const { indent, eol, finalNewline, bom } = scene.style;
  let out = JSON.stringify(scene.data, null, indent);
  if (eol !== "\n") out = out.replace(/\n/g, eol);
  return (bom ? "\ufeff" : "") + out + (finalNewline ? eol : "");
}

/** The text to save: the bytes that were read if nothing changed. */
export function serializeScene(scene: Scene): string {
  return scene.dirty ? stringifyScene(scene) : scene.source;
}

/** Elements to draw: known types that aren't deleted. */
export function liveElements(scene: Scene): DrawingElement[] {
  return scene.elements.filter(e => e.known && !e.isDeleted);
}

export function findElement(scene: Scene, id: string): DrawingElement | undefined {
  for (let i = scene.elements.length - 1; i >= 0; i--) if (scene.elements[i].id === id) return scene.elements[i];
  return undefined;
}

const sameJson = (a: unknown, b: unknown) => a === b || typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b);

// Set `key` on a raw record. A key the record lacks goes where a fresh element
// of this type would have it, without moving any key already there.
function setKey(raw: JsonObject, key: string, value: Json | undefined): JsonObject {
  if (value === undefined) { delete raw[key]; return raw; }
  if (key in raw) { raw[key] = value; return raw; }
  const type = raw.type === "draw" ? "line" : String(raw.type);
  const order = [...BASE_KEYS, ...(TYPE_KEYS[type] ?? [])];
  const rank = order.indexOf(key);
  const entries = Object.entries(raw);
  const before = rank < 0 ? -1 : entries.findIndex(([k]) => order.indexOf(k) > rank);
  if (before < 0) { raw[key] = value; return raw; }
  entries.splice(before, 0, [key, value]);
  return Object.fromEntries(entries);
}

function stamp(raw: JsonObject, s: Stamp): JsonObject {
  const random = s.random ?? Math.random;
  raw = setKey(raw, "version", num(raw.version, 0) + 1);
  raw = setKey(raw, "versionNonce", Math.floor(random() * 2 ** 31));
  return setKey(raw, "updated", (s.now ?? Date.now)());
}

/**
 * Change fields of element `id` (a value of `undefined` removes the key).
 * Unless the patch changes nothing, the element gets a new `version`,
 * `versionNonce` and `updated`. Returns the new view, or undefined if there is
 * no such element.
 */
export function updateElement(scene: Scene, id: string, patch: Record<string, Json | undefined>, s: Stamp = {}): DrawingElement | undefined {
  const el = findElement(scene, id);
  if (!el) return undefined;
  const list = scene.data.elements as Json[];
  let raw = list[el.slot] as JsonObject;
  let changed = false;
  for (const key in patch) {
    if (key === "id" || (key === "type" && typeof patch[key] !== "string")) continue;
    const value = patch[key];
    if (value === undefined ? !(key in raw) : sameJson(raw[key], value)) continue;
    raw = setKey(raw, key, value);
    changed = true;
  }
  if (!changed) return el;
  raw = stamp(raw, s);
  list[el.slot] = raw;
  const next = viewElement(raw, el.slot)!;
  scene.elements[scene.elements.indexOf(el)] = next;
  scene.dirty = true;
  return next;
}

/** Mark element `id` deleted. Like Excalidraw, the record stays in the file. */
export function deleteElement(scene: Scene, id: string, s: Stamp = {}) {
  return updateElement(scene, id, { isDeleted: true }, s);
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A complete new element of `type`, with every default written out. */
export function newElementRecord(type: string, props: Record<string, Json> = {}, s: Stamp = {}): JsonObject {
  const random = s.random ?? Math.random;
  const int = () => Math.floor(random() * 2 ** 31);
  let id = "";
  for (let i = 0; i < 20; i++) id += ID_CHARS[Math.floor(random() * ID_CHARS.length)];
  const el: JsonObject = {
    id, type, x: 0, y: 0, width: 0, height: 0, angle: 0,
    strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2,
    strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null,
    seed: int(), version: 1, versionNonce: int(), isDeleted: false, boundElements: null,
    updated: (s.now ?? Date.now)(), link: null, locked: false,
  };
  if (type === "text") Object.assign(el, { text: "", fontSize: 20, fontFamily: 1, textAlign: "left", verticalAlign: "top", containerId: null, originalText: "", autoResize: true, lineHeight: 1.25 });
  if (type === "line" || type === "arrow") Object.assign(el, { points: [[0, 0]], lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: type === "arrow" ? "arrow" : null });
  if (type === "arrow") el.elbowed = false;
  if (type === "freedraw") Object.assign(el, { points: [[0, 0]], pressures: [], simulatePressure: true, lastCommittedPoint: null });
  if (type === "image") Object.assign(el, { fileId: null, status: "pending", scale: [1, 1], crop: null });
  if (type === "frame" || type === "magicframe") el.name = null;
  return Object.assign(el, props);
}

/** Append a new element and return its view. */
export function addElement(scene: Scene, type: string, props: Record<string, Json> = {}, s: Stamp = {}): DrawingElement {
  const raw = newElementRecord(type, props, s);
  if (!Array.isArray(scene.data.elements)) scene.data = setKey(scene.data, "elements", []);
  const list = scene.data.elements as Json[];
  list.push(raw);
  const el = viewElement(raw, list.length - 1);
  if (!el) throw new Error("A new element needs a string id and type.");
  scene.elements.push(el);
  scene.dirty = true;
  return el;
}
