// Whitelisted formula values/functions. There is no dispatch through a JS
// object's properties or prototype; Context is the only bridge to note data.
import { isUnder, trimSlashes } from "../paths";
import { addDuration, datePart, durationMilliseconds, formatFormulaDate, FormulaDate, FormulaDuration, parseDate, parseDuration, today } from "./dates";
export { FormulaDate, FormulaDuration } from "./dates";

export class FormulaError extends Error {
  readonly kind = "error";
  constructor(message: string, readonly phase: "parse" | "evaluate" = "evaluate", readonly position?: number) { super(message); this.name = "FormulaError"; }
  toString() { return `#ERROR: ${this.message}`; }
}
export class FormulaLink {
  readonly kind = "link";
  constructor(readonly path: string, readonly display?: string) { Object.freeze(this); }
  toString() { return `[[${this.path}${this.display === undefined ? "" : `|${this.display}`}]]`; }
}
export type Value = string | number | boolean | null | Value[] | FormulaDate | FormulaDuration | FormulaLink | FormulaFile | FormulaError;
export interface Context {
  get(key: string): Value;
  hasTag(tag: string): boolean;
  hasLink(link: string): boolean;
  /** The embedding note; absent in a caller that has not supplied a host. */
  this?: Context | null;
  /** Existence, including properties with null/empty values. */
  hasProperty?(key: string): boolean;
  /** Optional clock for deterministic evaluation. Each expression samples it once. */
  now?(): number;
}
export class FormulaFile {
  readonly kind = "file";
  constructor(readonly context: Context) { Object.freeze(this); }
  toString() { return text(this.context.get("file.path")); }
}
export interface Runtime { left: number; time: number | undefined; clock: () => number; step(): void }
/** The clock is read at most once, at the first now()/today(): most expressions never pay for it. */
export function runtime(clock: number | (() => number) = Date.now): Runtime {
  return typeof clock === "number" ? new Work(() => clock) : new Work(clock);
}
class Work implements Runtime {
  left = 100_000;
  time: number | undefined = undefined;
  constructor(readonly clock: () => number) {}
  step() { if (--this.left < 0) throw Error("Formula work limit exceeded"); }
}
const nowOf = (rt: Runtime) => rt.time ??= rt.clock();
export const isFormulaError = (value: unknown): value is FormulaError => value instanceof FormulaError;
export const isEmpty = (v: Value) => v === null || v === "" || Array.isArray(v) && !v.length;
/** Preserve the original interpreter's boolean coercion (in particular, arrays are truthy). */
export function truthy(v: Value): boolean { checked(v); return !!v; }
export function checked(v: Value | undefined): Value {
  // Fast path for the common values: this runs on every node of every row.
  if (v === null || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v) || typeof v === "string" && v.length <= 100_000) return v;
  if (v === undefined) return null;
  if (v instanceof FormulaError) throw v;
  if (typeof v === "number" && !Number.isFinite(v)) throw Error("Number is not finite");
  if ((typeof v === "string" && v.length > 100_000) || (Array.isArray(v) && v.length > 10_000)) throw Error("Formula value is too large");
  if (v !== null && !["string", "number", "boolean"].includes(typeof v) && !Array.isArray(v) && !(v instanceof FormulaDate || v instanceof FormulaDuration || v instanceof FormulaLink || v instanceof FormulaFile)) throw Error("Unsupported formula value");
  return v;
}
export function finite(n: number): number { if (!Number.isFinite(n)) throw Error("Numeric result is not finite"); return Object.is(n, -0) ? 0 : n; }
function text(v: Value): string { if (typeof checked(v) !== "string") throw Error("Expected text"); return v as string; }
function number(v: Value): number { if (typeof checked(v) !== "number") throw Error("Expected a number"); return v as number; }
function date(v: Value): FormulaDate | null { return v instanceof FormulaDate || typeof v === "string" || typeof v === "number" ? parseDate(v) : null; }
function duration(v: Value): FormulaDuration | null { return v instanceof FormulaDuration || typeof v === "string" ? parseDuration(v) : null; }

export function equalValues(a: Value, b: Value, rt = runtime(), depth = 0, emptyEquivalent = true): boolean {
  rt.step(); checked(a); checked(b);
  if (depth > 50) throw Error("Value nesting is too deep");
  if (a === b || emptyEquivalent && isEmpty(a) && isEmpty(b)) return true;
  if (a instanceof FormulaDate || b instanceof FormulaDate) {
    const x = a instanceof FormulaDate || typeof a === "string" ? date(a) : null;
    const y = b instanceof FormulaDate || typeof b === "string" ? date(b) : null;
    return !!x && !!y && x.time === y.time;
  }
  if (a instanceof FormulaFile && b instanceof FormulaFile) return a.context === b.context || text(a.context.get("file.path")) === text(b.context.get("file.path"));
  if (a instanceof FormulaDuration && b instanceof FormulaDuration) return a.months === b.months && finite(a.days * 86_400_000 + a.milliseconds) === finite(b.days * 86_400_000 + b.milliseconds);
  if (a instanceof FormulaLink && b instanceof FormulaLink) return a.path === b.path;
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equalValues(v, b[i], rt, depth + 1, emptyEquivalent));
}
const AVERAGE_MONTH = 30.436875 * 86_400_000;
/** Empty/incompatible values have no order. ISO date strings remain comparable to file facts. */
export function compareValues(a: Value, b: Value): number | null {
  checked(a); checked(b);
  if (isEmpty(a) || isEmpty(b)) return null;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  // A duration compares with duration text ("1 week"), so `now() - file.mtime > "1 week"` works.
  const ua = a instanceof FormulaDuration ? a : b instanceof FormulaDuration && typeof a === "string" ? parseDuration(a) : null;
  const ub = b instanceof FormulaDuration ? b : a instanceof FormulaDuration && typeof b === "string" ? parseDuration(b) : null;
  // Months have no fixed length; ordering (not equality) uses the average Gregorian month.
  if (ua && ub) return (ua.months - ub.months) * AVERAGE_MONTH + (ua.days - ub.days) * 86_400_000 + ua.milliseconds - ub.milliseconds;
  const da = a instanceof FormulaDate || typeof a === "string" ? date(a) : null;
  const db = b instanceof FormulaDate || typeof b === "string" ? date(b) : null;
  if (da && db) return da.time - db.time;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return null;
}
function joinValues(values: Value[], separator: string, rt: Runtime, depth: number): string {
  let result = "";
  for (let i = 0; i < values.length; i++) {
    rt.step();
    const piece = displayValue(values[i], rt, depth);
    if (result.length + (i ? separator.length : 0) + piece.length > 100_000) throw Error("Formula value is too large");
    result += (i ? separator : "") + piece;
  }
  return result;
}
export function displayValue(v: Value, rt = runtime(), depth = 0): string {
  rt.step(); checked(v);
  if (depth > 50) throw Error("Value nesting is too deep");
  return Array.isArray(v) ? joinValues(v, ", ", rt, depth + 1) : v === null ? "" : text(checked(String(v)));
}

export function arithmetic(op: string, a: Value, b: Value, rt = runtime()): Value {
  checked(a); checked(b);
  const da = a instanceof FormulaDate || typeof a === "string" ? date(a) : null;
  const db = b instanceof FormulaDate || typeof b === "string" ? date(b) : null;
  const ua = duration(a), ub = duration(b);
  if ((op === "+" || op === "-") && da && ub) return addDuration(da, ub, op === "+" ? 1 : -1);
  if (op === "+" && ua && db) return addDuration(db, ua);
  if (op === "-" && da && db) return new FormulaDuration(0, 0, da.time - db.time);
  if ((op === "+" || op === "-") && a instanceof FormulaDuration && b instanceof FormulaDuration) {
    const sign = op === "+" ? 1 : -1;
    return new FormulaDuration(a.months + sign * b.months, a.days + sign * b.days, a.milliseconds + sign * b.milliseconds);
  }
  if (op === "+" && (typeof a === "string" || typeof b === "string") && !(a instanceof FormulaDate || b instanceof FormulaDate)) return checked(displayValue(a, rt) + displayValue(b, rt));
  if (a === null || b === null) return null;
  const x = number(a), y = number(b);
  if ((op === "/" || op === "%") && y === 0) throw Error("Division by zero");
  return finite(op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : x % y);
}

type Arity = readonly [number, number];
const globals = new Map<string, Arity>([["date", [1, 1]], ["now", [0, 0]], ["today", [0, 0]], ["duration", [1, 1]], ["if", [3, 3]], ["list", [0, 500]], ["number", [1, 1]], ["link", [1, 2]], ["min", [0, 500]], ["max", [0, 500]], ["contains", [2, 2]]]);
const methods = new Map<string, Arity>([["contains", [1, 1]], ["startsWith", [1, 1]], ["endsWith", [1, 1]], ["lower", [0, 0]], ["upper", [0, 0]], ["trim", [0, 0]], ["join", [0, 1]], ["isEmpty", [0, 0]], ["format", [1, 1]], ["round", [0, 1]], ["toFixed", [0, 1]], ["hasTag", [1, 1]], ["hasLink", [1, 1]], ["inFolder", [1, 1]], ["hasProperty", [1, 1]], ["asLink", [0, 1]]]);
export const fileProperties: ReadonlySet<string> = new Set(["name", "path", "folder", "ext", "mtime", "ctime", "tags", "size", "links", "backlinks", "embeds", "properties"]);
export const valueProperties: ReadonlySet<string> = new Set(["length", "year", "month", "day"]);
export function validateCall(name: string, count: number, method = false) {
  const arity = (method ? methods : globals).get(name);
  if (!arity) throw Error(`Unsupported ${method ? "method" : "function"}: ${name}`);
  if (count < arity[0] || count > arity[1]) throw Error(`Expected ${arity[0] === arity[1] ? arity[0] : `${arity[0]}–${arity[1]}`} arguments for ${name}`);
}
export function member(v: Value, name: string): Value {
  checked(v);
  if (v === null) return null;
  if (name === "length" && (typeof v === "string" || Array.isArray(v))) return v.length;
  if (["year", "month", "day"].includes(name)) {
    const d = v instanceof FormulaDate || typeof v === "string" ? date(v) : null;
    if (d) return datePart(d, name as "year" | "month" | "day");
  }
  throw Error(`Property ${name} is not available on this value`);
}
export function globalFunction(name: string, args: Value[], context: Context, rt: Runtime): Value {
  validateCall(name, args.length); args.forEach(checked);
  const v = args[0];
  switch (name) {
    case "if": return truthy(v) ? args[1] : args[2]; // The AST evaluates this lazily.
    case "now": return new FormulaDate(nowOf(rt));
    case "today": return today(nowOf(rt));
    case "date": { if (v === null) return null; const out = date(v); if (!out) throw Error("Expected an ISO date or timestamp"); return out; }
    case "duration": { if (v === null) return null; const out = typeof v === "number" ? parseDuration(v) : duration(v); if (!out) throw Error("Invalid duration"); return out; }
    case "list": return args;
    case "number": {
      if (v === null || typeof v === "string" && !v.trim()) return null;
      if (v instanceof FormulaDuration) return durationMilliseconds(v);
      if (typeof v === "boolean") return Number(v);
      if (typeof v === "number") return v;
      if (typeof v !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v.trim())) throw Error("Cannot convert value to a number");
      return finite(Number(v));
    }
    case "link": {
      if (v === null) return null;
      const path = v instanceof FormulaFile ? text(v.context.get("file.path")) : v instanceof FormulaLink ? v.path : text(v);
      return new FormulaLink(path, args.length > 1 ? text(args[1]) : v instanceof FormulaLink ? v.display : undefined);
    }
    case "contains": return methodFunction(v, "contains", [args[1]], context, rt);
    case "min": case "max": {
      const values = args.length === 1 && Array.isArray(v) ? v : args;
      let result: number | null = null;
      for (const item of values) { rt.step(); if (item === null) continue; const n = number(item); result = result === null ? n : name === "min" ? Math.min(n, result) : Math.max(n, result); }
      return result;
    }
    default: throw Error(`Unsupported function: ${name}`);
  }
}
export function methodFunction(value: Value, name: string, args: Value[], context: Context, rt: Runtime): Value {
  validateCall(name, args.length, true); checked(value); args.forEach(checked);
  if (name === "isEmpty") return isEmpty(value);
  if (name === "contains") {
    if (value === null) return false;
    if (typeof value === "string") return value.includes(displayValue(args[0], rt));
    if (Array.isArray(value)) { for (const item of value) { rt.step(); if (equalValues(item, args[0], rt, 0, false)) return true; } return false; }
    throw Error("contains requires text or a list");
  }
  if (value === null) return null;
  if (value instanceof FormulaFile) {
    const c = value.context;
    switch (name) {
      case "hasTag": return c.hasTag(text(args[0]));
      case "hasLink": return c.hasLink(args[0] instanceof FormulaLink ? args[0].path : args[0] instanceof FormulaFile ? text(args[0].context.get("file.path")) : text(args[0]));
      case "inFolder": { const folder = trimSlashes(text(args[0])); return !folder || isUnder(text(c.get("file.folder") ?? ""), folder); }
      case "hasProperty": { const key = text(args[0]).replace(/^note\./, ""); return c.hasProperty ? c.hasProperty(key) : checked(c.get(`note.${key}`)) !== null || checked(c.get(key)) !== null; }
      case "asLink": return globalFunction("link", args.length ? [value, args[0]] : [value], context, rt);
      default: throw Error(`Method ${name} is not available on files`);
    }
  }
  switch (name) {
    case "startsWith": return text(value).startsWith(text(args[0]));
    case "endsWith": return text(value).endsWith(text(args[0]));
    case "lower": return checked(text(value).toLowerCase());
    case "upper": return checked(text(value).toUpperCase());
    case "trim": return text(value).trim();
    case "join": {
      if (!Array.isArray(value)) throw Error("join requires a list");
      const separator = args.length ? text(args[0]) : ", ";
      return joinValues(value, separator, rt, 1);
    }
    case "format": { const d = value instanceof FormulaDate || typeof value === "string" ? date(value) : null; if (!d) throw Error("format requires a date"); return formatFormulaDate(d, text(args[0])); }
    case "round": case "toFixed": {
      const n = number(value), digits = args.length ? number(args[0]) : 0;
      if (!Number.isInteger(digits) || digits < (name === "round" ? -100 : 0) || digits > 100) throw Error("Invalid decimal precision");
      if (name === "toFixed") return n.toFixed(digits);
      const shift = (value: number, places: number) => {
        const [coefficient, exponent = "0"] = value.toString().split("e");
        return Number(`${coefficient}e${Number(exponent) + places}`);
      };
      const scaled = shift(n, digits);
      return Number.isFinite(scaled) ? finite(shift(Math.round(scaled), -digits)) : n;
    }
    default: throw Error(`Method ${name} is not available on this value`);
  }
}
