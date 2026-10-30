import { compileFormula, FormulaDate, FormulaError, type Context, type Expression, type Value } from "./expression";
import { checked, isEmpty } from "./functions";
import { parseDate } from "./dates";
import { runSliced, runSync, sortWork, valueKey, type Entry, type RowGroup, type SliceOptions } from "./groups";
import type { Yaml } from "./yaml";

export const SUMMARY_NAMES = ["Count", "Empty", "Filled", "Unique", "Sum", "Average", "Min", "Max", "Range", "Median", "Earliest", "Latest", "Checked", "Unchecked"] as const;
const ids = new Set<string>(SUMMARY_NAMES.map(name => name.toLowerCase()));
const canonical = (key: string) => /^(file|formula)\./.test(key) ? key : `note.${key.replace(/^note\./, "")}`;
export interface SummaryPlan { selected: ReadonlyMap<string, string>; custom: ReadonlyMap<string, Expression> }
export interface SummaryResults { all: ReadonlyMap<string, Value>; groups: ReadonlyMap<string, ReadonlyMap<string, Value>> }
export function parseSummaryPlan(custom: Yaml | undefined, selected: Yaml | undefined, notices: Set<string>): SummaryPlan {
  const definitions = new Map<string, Expression>(), choices = new Map<string, string>();
  for (const [value, name] of [[custom, "summaries"], [selected, "view summaries"]] as const) if (value != null && (typeof value !== "object" || Array.isArray(value))) throw Error(`${name} must be a mapping`);
  for (const [name, source] of Object.entries(custom ?? {})) {
    const error = new FormulaError(`Summary ${name} must be an expression`, "parse");
    const compiled: Expression = typeof source === "string" ? compileFormula(source) : Object.assign(() => error, { error });
    if (compiled.error) notices.add(`Summary ${name}: ${compiled.error.message}`);
    definitions.set(name, compiled);
  }
  for (const [property, name] of Object.entries(selected ?? {})) {
    if (typeof name !== "string" || !name.trim()) throw Error("A view summary must name a built-in or custom summary");
    choices.set(canonical(property), name);
    if (!ids.has(name.toLowerCase()) && !definitions.has(name.replace(/^custom\./, ""))) notices.add(`Unknown summary: ${name}`);
  }
  return { selected: choices, custom: definitions };
}
export const summaryFor = (plan: SummaryPlan, key: string) => plan.selected.get(canonical(key));

function requirements(name: string, plan: SummaryPlan, out = new Set<string>(), seen = new Set<string>()): Set<string> {
  if (ids.has(name.toLowerCase()) && !name.startsWith("custom.")) { out.add(name.toLowerCase()); return out; }
  name = name.replace(/^custom\./, "");
  if (seen.has(name)) return out;
  seen.add(name);
  for (let key of plan.custom.get(name)?.dependencies ?? []) {
    if (key.startsWith("formula.")) requirements(`custom.${key.slice(8)}`, plan, out, seen);
    else { key = key.replace(/^note\./, ""); if (ids.has(key.toLowerCase())) out.add(key.toLowerCase()); else if (key === "values") out.add(key); }
  }
  return out;
}
interface State {
  count: number; empty: number; numeric: number; sum: number; compensation: number; mean: number;
  min: number | null; max: number | null; checked: number; unchecked: number; earliest: FormulaDate | null; latest: FormulaDate | null;
  unique: Set<string> | null; numbers: number[] | null; median: number | null; values: Value[] | null; valuesError?: FormulaError; error?: FormulaError;
}
function state(count: number, needs: Set<string>): State {
  if (!needs.size || needs.size === 1 && needs.has("count")) return { count } as State;
  return { count, empty: 0, numeric: 0, sum: 0, compensation: 0, mean: 0, min: null, max: null, checked: 0, unchecked: 0, earliest: null, latest: null,
    unique: needs.has("unique") ? new Set() : null, numbers: needs.has("median") ? [] : null, median: null, values: needs.has("values") ? [] : null };
}
const errorOf = (e: unknown) => e instanceof FormulaError ? e : new FormulaError(e instanceof Error ? e.message : String(e));
function feed(s: State, value: Value, key: string | undefined, date: FormulaDate | null) {
  if (value instanceof FormulaError) { s.error ??= value; return; }
  if (s.values && !s.valuesError) {
    if (s.values.length === 10_000) { s.valuesError = new FormulaError("Custom summary values exceed the formula list limit (10000); use count/sum/average or a smaller group"); s.values = null; }
    else s.values.push(value);
  }
  if (isEmpty(value)) { s.empty++; return; }
  if (s.unique) s.unique.add(key!);
  if (typeof value === "number") {
    s.numeric++;
    const corrected = value - s.compensation, sum = s.sum + corrected;
    s.compensation = (sum - s.sum) - corrected; s.sum = sum;
    s.mean = s.numeric === 1 ? value : s.mean * ((s.numeric - 1) / s.numeric) + value / s.numeric;
    s.min = s.min === null ? value : Math.min(s.min, value); s.max = s.max === null ? value : Math.max(s.max, value);
    s.numbers?.push(value);
  } else if (value === true) s.checked++;
  else if (value === false) s.unchecked++;
  if (date) {
    if (!s.earliest || date.time < s.earliest.time) s.earliest = date;
    if (!s.latest || date.time > s.latest.time) s.latest = date;
  }
}
function numeric(value: number | null): Value { return value === null || Number.isFinite(value) ? value : new FormulaError("Summary numeric result is not finite"); }
function stat(s: State, name: string): Value {
  if (name === "count") return s.count;
  if (s.error) return s.error;
  switch (name) {
    case "empty": return s.empty;
    case "filled": return s.count - s.empty;
    case "unique": return s.unique?.size ?? 0;
    case "sum": return numeric(s.sum);
    case "average": return s.numeric ? numeric(Number.isFinite(s.sum) ? s.sum / s.numeric : s.mean) : null;
    case "min": return s.min;
    case "max": return s.max;
    case "range": return s.min === null || s.max === null ? null : numeric(s.max - s.min);
    case "median": return numeric(s.median);
    case "earliest": return s.earliest;
    case "latest": return s.latest;
    case "checked": return s.checked;
    case "unchecked": return s.unchecked;
    default: return null;
  }
}
function* finish(s: State): Generator<void> {
  if (!s.numbers?.length) return;
  const sorted = yield* sortWork(s.numbers, (a, b) => a - b), middle = Math.floor(sorted.length / 2);
  s.median = sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2;
  s.numbers = null;
}
function evaluate(name: string, s: State, plan: SummaryPlan, host?: Context): Value {
  if (ids.has(name.toLowerCase()) && !name.startsWith("custom.")) return stat(s, name.toLowerCase());
  const active = new Set<string>(), cache = new Map<string, Value>();
  const custom = (key: string): Value => {
    key = key.replace(/^custom\./, "");
    if (cache.has(key)) return cache.get(key)!;
    if (active.has(key)) return new FormulaError(`Circular summary: ${key}`);
    const program = plan.custom.get(key);
    if (!program) return new FormulaError(`Unknown summary: ${key}`);
    active.add(key);
    try { const result = program(context); cache.set(key, result); return result; }
    finally { active.delete(key); }
  };
  const context: Context = { get(key) {
    if (key.startsWith("formula.")) return custom(key.slice(8));
    key = key.replace(/^note\./, "");
    if (key === "values") return s.error ?? s.valuesError ?? s.values ?? [];
    return stat(s, key.toLowerCase());
  }, hasTag: () => false, hasLink: () => false, this: host };
  return custom(name);
}

/** One pass feeds each group's and the overall aggregate, reading a property once. */
export function* summaryWork(entries: readonly Entry[], groups: readonly RowGroup[], plan: SummaryPlan, host?: Context): Generator<void, SummaryResults> {
  if (!plan.selected.size) return { all: new Map(), groups: new Map() };
  const columns = [...plan.selected].map(([property, name]) => ({ property, name, needs: requirements(name, plan) }));
  const allStates = columns.map(column => state(entries.length, column.needs)), result = new Map<string, ReadonlyMap<string, Value>>();
  const dates = new Map<string, FormulaDate | null>();
  const scanned = columns.flatMap((column, i) => column.needs.size && !(column.needs.size === 1 && column.needs.has("count")) ? [i] : []);
  const oneGroup = groups.length === 1 && groups[0].rows.length === entries.length;
  let steps = 0;
  for (const group of groups) {
    const states = oneGroup ? allStates : columns.map(column => state(group.rows.length, column.needs));
    for (const entry of group.rows) for (const i of scanned) {
      const { needs, property } = columns[i];
      let value: Value, key: string | undefined, date: FormulaDate | null = null;
      try {
        value = checked(entry.context.get(property));
        if (needs.has("unique") && !isEmpty(value)) key = valueKey(value);
        if (needs.has("earliest") || needs.has("latest")) {
          if (value instanceof FormulaDate) date = value;
          else if (typeof value === "string") {
            const known = dates.get(value);
            if (known !== undefined) date = known;
            else { date = parseDate(value); if (dates.size < 10000) dates.set(value, date); }
          }
        }
      } catch (e) { value = errorOf(e); }
      feed(states[i], value, key, date);
      if (!oneGroup) feed(allStates[i], value, key, date);
      if (++steps % 64 === 0) yield;
    }
    const values = new Map<string, Value>();
    for (let i = 0; i < columns.length; i++) {
      yield* finish(states[i]);
      values.set(columns[i].property, evaluate(columns[i].name, states[i], plan, host));
      if (++steps % 64 === 0) yield;
    }
    result.set(group.id, values);
  }
  const all = new Map<string, Value>();
  for (let i = 0; i < columns.length; i++) {
    if (!oneGroup) yield* finish(allStates[i]);
    all.set(columns[i].property, evaluate(columns[i].name, allStates[i], plan, host));
    if (++steps % 64 === 0) yield;
  }
  return { all, groups: result };
}
export const summarize = (entries: readonly Entry[], groups: readonly RowGroup[], plan: SummaryPlan, host?: Context) => runSync(summaryWork(entries, groups, plan, host));
export const summarizeAsync = (entries: readonly Entry[], groups: readonly RowGroup[], plan: SummaryPlan, options?: SliceOptions, host?: Context) => runSliced(summaryWork(entries, groups, plan, host), options);
export const summaryValue = (values: ReadonlyMap<string, Value>, key: string) => values.get(canonical(key)) ?? null;
