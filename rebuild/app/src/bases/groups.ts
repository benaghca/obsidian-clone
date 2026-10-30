import { compareNames } from "../paths";
import { checked, displayValue, FormulaDate, FormulaDuration, FormulaFile, FormulaLink, isEmpty, isFormulaError, type Context, type Value } from "./functions";
import { parseDate } from "./dates";
import type { Row } from "./model";
import { writeFilters } from "./write";
import type { Yaml } from "./yaml";
import { h, pressable } from "../shell/dom";
import { icon } from "../shell/icons";
import type { Workspace } from "../workspace";
import type { Group } from "../tabs";
import type { PropertyType } from "../editor/frontmatter";
import type { baseModel } from "./model";
import { summarizeAsync, type SummaryResults } from "./summaries";

export interface Entry { row: Row; context: Context }
export interface GroupBy { property: string; direction: "ASC" | "DESC" }
export interface RowGroup { id: string; value: Value; label: string; rows: Entry[]; order?: number; error?: Error }
export interface SliceOptions { cancelled?: () => boolean; budgetMs?: number; yieldTask?: () => Promise<void>; onSlice?: (ms: number) => void }
export function parseGroupBy(value: Yaml | undefined): GroupBy | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value) || typeof value.property !== "string" || !value.property.trim() || !["ASC", "DESC"].includes(String(value.direction ?? "ASC"))) throw Error("groupBy requires a property and ASC or DESC direction");
  return { property: value.property, direction: value.direction === "DESC" ? "DESC" : "ASC" };
}

/** Typed structural keys shared by grouping and Unique; bounded like formula output. */
export function valueKey(value: Value): string {
  value = checked(value);
  // Common tag/list columns need no recursive encoder or per-value Set.
  if (Array.isArray(value) && value.length > 0 && value.length <= 1000) {
    let chars = 0, strings = true;
    for (const item of value) if (typeof item !== "string" || !item || /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(item) || (chars += item.length) > 16000) { strings = false; break; }
    if (strings) return `ls:${JSON.stringify(value)}`;
  }
  const scalar = (v: Value): string | null => {
    if (isEmpty(v)) return "empty";
    if (v instanceof FormulaDate) return `d:${v.time}`;
    if (v instanceof FormulaDuration) { const fixed = v.days * 86400000 + v.milliseconds; if (!Number.isFinite(fixed)) throw Error("Grouping duration is out of range"); return `u:${v.months}:${fixed}`; }
    if (v instanceof FormulaLink) return `l:${JSON.stringify(v.path)}`;
    if (v instanceof FormulaFile) { const path = checked(v.context.get("file.path")); if (typeof path !== "string") throw Error("A file grouping value needs a path"); return `f:${JSON.stringify(path)}`; }
    if (Array.isArray(v)) return null;
    if (typeof v === "string") { const date = /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(v) ? parseDate(v) : null; return date ? `d:${date.time}` : `s:${JSON.stringify(v)}`; }
    return `${typeof v}:${String(v)}`;
  };
  const simple = scalar(value);
  if (simple !== null) { if (simple.length > 100_000) throw Error("Grouping value is too large"); return simple; }
  let size = 0, steps = 100_000;
  const active = new Set<Value[]>();
  const encode = (v: Value, depth: number): string => {
    v = checked(v);
    if (--steps < 0 || depth > 50) throw Error("Grouping value is too complex");
    let key: string;
    const simple = scalar(v);
    if (simple !== null) key = simple;
    else if (Array.isArray(v)) {
      if (active.has(v)) throw Error("Cyclic grouping value");
      active.add(v); key = "[";
      for (const item of v) { const part = encode(item, depth + 1); if (key.length + part.length > 100_000) throw Error("Grouping value is too large"); key += part.length + ":" + part; }
      active.delete(v); key += "]";
    } else throw Error("Unsupported grouping value");
    size += key.length;
    if (size > 100_000) throw Error("Grouping value is too large");
    return key;
  };
  return encode(value, 0);
}

function groupOrder(value: Value): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return Number(value);
  if (value instanceof FormulaDate) return value.time;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value)) return parseDate(value)?.time;
  if (value instanceof FormulaDuration) return value.months * 30.436875 * 86400000 + value.days * 86400000 + value.milliseconds;
  return undefined;
}

/** Stable mergesort yields during comparisons/copying, including 50k distinct groups. */
export function* sortWork<T>(values: T[], compare: (a: T, b: T) => number): Generator<void, T[]> {
  let from = values.slice(), to = new Array<T>(values.length), steps = 0;
  for (let width = 1; width < values.length; width *= 2) {
    for (let start = 0; start < values.length; start += width * 2) {
      let left = start, right = Math.min(start + width, values.length);
      const mid = right, end = Math.min(start + width * 2, values.length);
      for (let at = start; at < end; at++) {
        to[at] = left < mid && (right >= end || compare(from[left], from[right]) <= 0) ? from[left++] : from[right++];
        if (++steps % 64 === 0) yield;
      }
    }
    [from, to] = [to, from];
  }
  return from;
}
export function* groupWork(entries: readonly Entry[], config: GroupBy | null): Generator<void, RowGroup[]> {
  if (!config) return [{ id: "all", value: null, label: "All results", rows: entries as Entry[] }];
  const groups = new Map<string, RowGroup>();
  let steps = 0;
  for (const entry of entries) {
    let value: Value = null, id: string, error: Error | undefined;
    try { value = checked(entry.context.get(config.property)); id = valueKey(value); }
    catch (e) { value = null; id = "empty"; error = e instanceof Error ? e : Error(String(e)); }
    let group = groups.get(id);
    if (!group) groups.set(id, group = { id, value, label: id === "empty" ? "Empty" : displayValue(value), rows: [], order: groupOrder(value) });
    group.error ??= error;
    group.rows.push(entry);
    if (++steps % 64 === 0) yield;
  }
  const direction = config.direction === "DESC" ? -1 : 1;
  return yield* sortWork([...groups.values()], (a, b) => {
    if ((a.id === "empty") !== (b.id === "empty")) return a.id === "empty" ? 1 : -1;
    const order = a.order !== undefined && b.order !== undefined ? a.order - b.order : compareNames(a.label, b.label);
    return direction * order;
  });
}
export function runSync<T>(work: Generator<void, T>): T { let step = work.next(); while (!step.done) step = work.next(); return step.value; }
/** Begin each continuation after paint, with a frame's slack before the next deadline. */
export function yieldFrame(): Promise<void> {
  return new Promise(resolve => { if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(resolve, 0)); else setTimeout(resolve, 0); });
}
export async function runSliced<T>(work: Generator<void, T>, options: SliceOptions = {}): Promise<T> {
  let start = performance.now();
  const check = () => { if (options.cancelled?.()) { const e = Error("Base computation cancelled"); e.name = "AbortError"; throw e; } };
  const pause = options.yieldTask ?? yieldFrame;
  try {
    while (true) {
      check();
      const step = work.next();
      if (step.done) { options.onSlice?.(performance.now() - start); return step.value; }
      if (performance.now() - start >= (options.budgetMs ?? 5)) {
        options.onSlice?.(performance.now() - start);
        await pause(); start = performance.now();
      }
    }
  } finally { work.return(undefined as T); }
}
export const groupRows = (entries: readonly Entry[], config: GroupBy | null) => runSync(groupWork(entries, config));
export const groupRowsAsync = (entries: readonly Entry[], config: GroupBy | null, options?: SliceOptions) => runSliced(groupWork(entries, config), options);

/** The shared writer owns its old keys; serialize new values with its existing YAML serializer. */
export function writeViewSetting(source: string, key: "groupBy" | "summaries", value: Yaml | undefined, viewIndex = 0): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n", lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const text = (i: number) => lines[i].replace(/\r?\n$/, ""), significant = (i: number) => !!text(i).trim() && !text(i).trimStart().startsWith("#");
  const indent = (i: number) => /^ */.exec(text(i))![0].length;
  const block = (level: number) => value === undefined ? "" : (key + writeFilters("", value).slice(7)).split("\n").slice(0, -1).map(line => " ".repeat(level) + line).join(eol) + eol;
  const views = lines.findIndex((_, i) => /^(?:views|"views"|'views')\s*:/.test(text(i).replace(/^\uFEFF/, "")));
  if (views < 0 || /:\s*\[\]\s*(?:#.*)?$/.test(text(views))) {
    if (value === undefined) return source;
    if (viewIndex) throw Error("View does not exist");
    const prefix = views < 0 ? source + (source && !source.endsWith("\n") ? eol : "") : lines.slice(0, views).join("") + (text(views).startsWith("\uFEFF") ? "\uFEFF" : "");
    return prefix + `views:${eol}  - type: table${eol}    name: View${eol}` + block(4) + (views < 0 ? "" : lines.slice(views + 1).join(""));
  }
  let end = views + 1;
  while (end < lines.length && (!significant(end) || indent(end) > 0)) end++;
  const starts: number[] = []; let itemIndent = -1;
  for (let i = views + 1; i < end; i++) if (significant(i) && /^ *-\s/.test(text(i))) { if (itemIndent < 0) itemIndent = indent(i); if (indent(i) === itemIndent) starts.push(i); }
  const start = starts[viewIndex]; if (start === undefined) throw Error("View does not exist");
  end = starts[viewIndex + 1] ?? end;
  const level = itemIndent + 2;
  for (let at = start; at < end; at++) {
    const inline = at === start, body = text(at).slice(inline ? itemIndent + 2 : level);
    if (!(inline || indent(at) === level) || !new RegExp(`^(?:${key}|"${key}"|'${key}')\\s*:`).test(body)) continue;
    let stop = at + 1, last = stop;
    while (stop < end && (!significant(stop) || indent(stop) > level)) { if (significant(stop)) last = stop + 1; stop++; }
    let replacement = block(level);
    if (inline) replacement = replacement ? " ".repeat(itemIndent) + "- " + replacement.slice(level) : " ".repeat(itemIndent) + "-" + eol;
    if (last === lines.length && !source.endsWith("\n")) replacement = replacement.slice(0, -eol.length);
    return lines.slice(0, at).join("") + replacement + lines.slice(last).join("");
  }
  if (value === undefined) return source;
  while (end > start + 1 && !significant(end - 1)) end--;
  const prefix = lines.slice(0, end).join("");
  return prefix + (prefix.endsWith("\n") ? "" : eol) + block(level) + lines.slice(end).join("");
}

type Model = ReturnType<typeof baseModel>;
type Grid = ReturnType<typeof import("./cards")["createCardGrid"]>;
const HEADER = 32, FOOTER = 44;
export interface GroupedHost {
  el: HTMLElement; scroller: HTMLElement; table: HTMLTableElement; body: HTMLTableSectionElement;
  ws: Workspace; group: Group; cell: (key: string, entry: Entry) => HTMLTableCellElement; repaint: () => void;
  header: (event: MouseEvent, key: string) => void;
  createCards: typeof import("./cards")["createCardGrid"];
  onSlice?: (ms: number) => void;
  summaryContext?: () => Context | undefined;
}
/** Shared, virtualized presentation. The host retains its normal unconfigured fast path. */
export function createGroupedView(host: GroupedHost) {
  const root = h("div", { class: "bases-b5-root" });
  root.hidden = true; host.scroller.append(root);
  let model: Model | null = null, selected: readonly Entry[] = [], groups: RowGroup[] = [], types = new Map<string, PropertyType>();
  let summaries: SummaryResults = { all: new Map(), groups: new Map() }, generation = 0, busy = false, gone = false;
  let footer: HTMLTableSectionElement | null = null, prefix = new Float64Array(1), layoutKey = "", revision = 0, painted = "";
  let cols = 1, cardHeight = 0, pitch = 0;
  let plainGrid: Grid | null = null, plainKey = "", focusedGroup: string | undefined;
  const rememberFocus = () => { const active = document.activeElement; if (active instanceof HTMLElement && host.el.contains(active) && active.matches(".bases-b5-toggle")) focusedGroup = active.dataset.groupId; };
  let collapsed = new Set<string>();
  const collapsedViews = new Map<string, Set<string>>(), grids = new Map<string, { grid: Grid; first: number; key: string; section: HTMLElement; viewport: HTMLElement }>();
  const addedNotices = new Set<string>(); let noticeModel: Model | null = null;
  const idOf = (g: RowGroup) => g.id;
  const clearGrids = () => { for (const item of grids.values()) item.grid.dispose(); grids.clear(); plainGrid?.dispose(); plainGrid = null; plainKey = ""; root.replaceChildren(); };
  const contextMenu = (event: MouseEvent) => { const field = (event.target as Element).closest<HTMLElement>(".bases-card-prop,.bases-b5-summary-cell"); if (field?.dataset.property) host.header(event, field.dataset.property); };
  host.scroller.addEventListener("contextmenu", contextMenu);
  const clearNotices = () => { for (const message of addedNotices) noticeModel?.notices.delete(message); addedNotices.clear(); };
  const showNotices = () => {
    const notice = host.el.querySelector<HTMLElement>(":scope > .bases-notice");
    if (notice && model) { notice.textContent = [...model.notices].join(" · "); notice.hidden = !notice.textContent; }
  };
  function summaryCell(key: string, values: ReadonlyMap<string, Value>, card = false): HTMLElement {
    const name = model!.summaryPlan.selected.get(/^(file|formula)\./.test(key) ? key : `note.${key.replace(/^note\./, "")}`);
    const el = card ? h("div", { class: "bases-b5-summary-cell", "data-property": key }) : h("td", { "data-property": key });
    if (!name) return el;
    const value = values.get(/^(file|formula)\./.test(key) ? key : `note.${key.replace(/^note\./, "")}`) ?? null;
    let text: string;
    try { text = isFormulaError(value) ? "#ERROR!" : displayValue(value); } catch { text = "#ERROR!"; }
    el.setAttribute("data-summary", name); el.setAttribute("data-value", text);
    el.title = isFormulaError(value) ? value.message : `${model!.label(key)}: ${name} ${text}`;
    el.classList.toggle("bases-b5-error", isFormulaError(value));
    el.append(h("span", { class: "bases-b5-summary-label" }, card ? `${model!.label(key)} · ${name.replace(/^custom\./, "")}` : name.replace(/^custom\./, "")), h("span", { class: "bases-b5-summary-value" }, text));
    return el;
  }
  const summaryRow = (values: ReadonlyMap<string, Value>, id: string) => h("tr", { class: "bases-b5-summary", "data-summary-group": id }, ...model!.columns.map(key => summaryCell(key, values)));
  function cardSummary(values: ReadonlyMap<string, Value>, id: string) {
    return h("div", { class: "bases-b5-card-summary", "data-summary-group": id }, ...model!.columns.filter(key => model!.summaryPlan.selected.has(/^(file|formula)\./.test(key) ? key : `note.${key.replace(/^note\./, "")}`)).map(key => summaryCell(key, values, true)));
  }
  function heading(g: RowGroup) {
    const id = idOf(g), shut = collapsed.has(id);
    const button = h("button", { type: "button", class: "bases-b5-toggle", "data-group-id": g.id, title: g.error?.message, "aria-expanded": String(!shut), "aria-label": `${g.label} (${g.rows.length})`,
      onfocusout: (event: FocusEvent) => event.stopPropagation() }, icon(shut ? "chevron-right" : "chevron-down", 14), h("span", null, g.label), h("span", { class: "bases-b5-count" }, String(g.rows.length)));
    return pressable(button, event => {
      event.stopPropagation(); shut ? collapsed.delete(id) : collapsed.add(id); revision++; layoutKey = ""; host.repaint();
    });
  }
  function layout() {
    if (!model) return;
    const width = host.scroller.clientWidth, key = `${generation}:${revision}:${width}`;
    if (key === layoutKey) return;
    layoutKey = key; painted = "";
    if (model.type === "cards") {
      const size = model.cardSize, count = model.columns.filter(key => key !== "file.name").length;
      cols = Math.max(1, Math.floor((Math.max(size, width - 32) + 16) / (size + 16)));
      cardHeight = 2 + (model.image ? Math.round(size * model.imageAspectRatio) : 0) + 42 + (count ? 8 + count * 22 : 0); pitch = cardHeight + 16;
    }
    prefix = new Float64Array(groups.length + 1);
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i], content = model.type === "cards" ? (g.rows.length ? Math.ceil(g.rows.length / cols) * pitch - 16 : 0) + 32 : g.rows.length * model.rowHeight;
      prefix[i + 1] = prefix[i] + HEADER + (collapsed.has(idOf(g)) ? 0 : content + (model.summaryPlan.selected.size ? FOOTER : 0));
    }
  }
  const firstGroup = (top: number) => {
    let lo = 0, hi = groups.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (prefix[mid + 1] <= top) lo = mid + 1; else hi = mid; }
    return lo;
  };
  function spacer(height: number) {
    const cell = h("td", { style: `height:${height}px;padding:0;border:0;box-shadow:none`, "aria-hidden": "true" }); cell.colSpan = Math.max(1, model!.columns.length);
    return h("tr", { class: "bases-spacer" }, cell);
  }
  function tablePaint(force: boolean) {
    const m = model!, top = Math.max(0, host.scroller.scrollTop - 30 - m.rowHeight * 8), bottom = host.scroller.scrollTop + host.scroller.clientHeight + m.rowHeight * 8;
    const units: { top: number; height: number; make: () => HTMLElement; key: string }[] = [];
    for (let i = firstGroup(top); i < groups.length && prefix[i] < bottom; i++) {
      const g = groups[i], start = prefix[i], dataStart = start + HEADER;
      if (dataStart >= top) units.push({ top: start, height: HEADER, key: `h${i}`, make: () => { const td = h("td"); td.colSpan = Math.max(1, m.columns.length); td.append(heading(g)); return h("tr", { class: "bases-b5-heading", "data-group": g.id }, td); } });
      if (collapsed.has(idOf(g))) continue;
      const first = Math.max(0, Math.floor((top - dataStart) / m.rowHeight)), end = Math.min(g.rows.length, Math.ceil((bottom - dataStart) / m.rowHeight));
      for (let row = first; row < end; row++) {
        const entry = g.rows[row];
        units.push({ top: dataStart + row * m.rowHeight, height: m.rowHeight, key: `r${i}:${row}`, make: () => h("tr", { "data-path": entry.row.file.path }, ...m.columns.map(key => host.cell(key, entry))) });
      }
      const foot = dataStart + g.rows.length * m.rowHeight;
      if (m.summaryPlan.selected.size && foot + FOOTER >= top && foot < bottom) units.push({ top: foot, height: FOOTER, key: `f${i}`, make: () => summaryRow(summaries.groups.get(g.id) ?? new Map(), g.id) });
    }
    const key = `${generation}:${revision}:${units.map(u => u.key).join(",")}`;
    if (!force && painted === key) return;
    painted = key;
    const fragment = document.createDocumentFragment(); let at = 0;
    for (const unit of units) { if (unit.top > at) fragment.append(spacer(unit.top - at)); fragment.append(unit.make()); at = unit.top + unit.height; }
    if (prefix[groups.length] > at) fragment.append(spacer(prefix[groups.length] - at));
    host.body.replaceChildren(fragment);
  }
  function cardPaint(force: boolean) {
    if (!model!.groupBy) {
      root.style.height = "";
      if (!plainGrid) { plainGrid = host.createCards(host.ws, host.group, host.scroller); root.prepend(plainGrid.el); }
      const key = `${generation}:${host.scroller.clientWidth}:${host.scroller.clientHeight}`;
      if (plainKey !== key) { plainKey = key; plainGrid.render(model!, selected as Entry[], types, true); }
      else if (force) plainGrid.onResize(); else plainGrid.onScroll();
      return;
    }
    const m = model!, top = Math.max(0, host.scroller.scrollTop - pitch * 2), bottom = host.scroller.scrollTop + host.scroller.clientHeight + pitch * 2, active = new Set<string>();
    root.style.height = `${prefix[groups.length] + (m.summaryPlan.selected.size ? FOOTER : 0)}px`;
    const allFooter = root.querySelector<HTMLElement>(":scope > .bases-b5-card-summary");
    if (allFooter) allFooter.style.top = `${prefix[groups.length]}px`;
    for (let i = firstGroup(top); i < groups.length && prefix[i] < bottom; i++) {
      const g = groups[i]; active.add(g.id);
      let item = grids.get(g.id);
      if (!item) {
        const section = h("section", { class: "bases-b5-section", "data-group": g.id }); root.append(section);
        const local = { first: 0 };
        const viewport = { get clientWidth() { return host.scroller.clientWidth; }, get clientHeight() { return host.scroller.clientHeight; }, get scrollTop() { return host.scroller.scrollTop - prefix[i] - HEADER - local.first * pitch; }, getBoundingClientRect: () => host.scroller.getBoundingClientRect() } as HTMLElement;
        // CardGrid only reads these viewport fields; its actual DOM and cover lifecycle are reused.
        const grid = host.createCards(host.ws, host.group, viewport);
        item = { grid, first: 0, key: "", section, viewport }; grids.set(g.id, item);
        Object.defineProperty(item, "first", { get: () => local.first, set: (n: number) => { local.first = n; } });
      }
      item.section.style.top = `${prefix[i]}px`;
      const shut = collapsed.has(idOf(g)), first = Math.min(Math.max(0, Math.ceil(g.rows.length / cols) - 1), Math.max(0, Math.floor((host.scroller.scrollTop - prefix[i] - HEADER - 16) / pitch) - 2)), end = Math.min(Math.ceil(g.rows.length / cols), first + Math.ceil(host.scroller.clientHeight / pitch) + 5);
      const key = `${generation}:${revision}:${cols}:${first}:${end}:${shut}`;
      if (force || item.key !== key) {
        item.key = key; item.first = first; item.section.replaceChildren(heading(g));
        if (shut) item.grid.clear();
        else {
          item.grid.render(m, g.rows.slice(first * cols, end * cols), types, true);
          item.grid.el.style.paddingTop = `${16 + first * pitch}px`;
          item.grid.el.style.paddingBottom = `${16 + Math.max(0, Math.ceil(g.rows.length / cols) - end) * pitch}px`;
          item.section.append(item.grid.el);
          if (m.summaryPlan.selected.size) item.section.append(cardSummary(summaries.groups.get(g.id) ?? new Map(), g.id));
        }
      } else if (!shut) item.grid.onScroll();
    }
    for (const [id, item] of grids) if (!active.has(id)) { item.grid.dispose(); item.section.remove(); grids.delete(id); }
  }
  function clear() {
    generation++; busy = false; focusedGroup = undefined; model = null; selected = []; groups = []; clearNotices(); clearGrids();
    footer?.remove(); footer = null; root.hidden = true; host.table.hidden = false; layoutKey = "";
    host.el.classList.remove("bases-b5-cards"); host.el.setAttribute("aria-busy", "false");
  }
  return {
    clear,
    async update(next: Model, rows: readonly Entry[], propertyTypes: Map<string, PropertyType>, obsolete: () => boolean = () => false): Promise<boolean> {
      const token = ++generation; busy = true; clearNotices(); noticeModel = next;
      host.el.setAttribute("aria-busy", "true");
      const options: SliceOptions = { cancelled: () => gone || token !== generation || obsolete(), onSlice: host.onSlice };
      try {
        if (next.type !== "cards" && !next.groupBy && !next.summaryPlan.selected.size) {
          model = null; selected = rows; clearGrids(); footer?.remove(); footer = null; root.hidden = true; host.el.classList.remove("bases-b5-cards"); busy = false; host.el.setAttribute("aria-busy", "false"); return true;
        }
        if (rows.length > 200 && (next.groupBy || next.summaryPlan.selected.size)) await yieldFrame();
        const grouped = await groupRowsAsync(rows, next.groupBy, options);
        const computed = await summarizeAsync(rows, grouped, next.summaryPlan, options, host.summaryContext?.());
        if (options.cancelled!()) return false;
        rememberFocus();
        model = next; selected = rows; groups = grouped; summaries = computed; types = propertyTypes; layoutKey = ""; clearGrids();
        const scope = `${next.viewIndex}:${next.groupBy?.property}`;
        collapsed = collapsedViews.get(scope) ?? new Set(); collapsedViews.set(scope, collapsed);
        host.el.classList.toggle("bases-b5-cards", next.type === "cards");
        root.hidden = next.type !== "cards"; footer?.remove(); footer = null;
        if (next.summaryPlan.selected.size && next.type === "table") { footer = h("tfoot", { class: "bases-b5-foot" }, summaryRow(computed.all, "all")); host.table.append(footer); }
        if (next.type === "cards") {
          host.scroller.append(root);
          const all = next.summaryPlan.selected.size ? cardSummary(computed.all, "all") : null;
          if (all) { if (next.groupBy) { all.style.position = "absolute"; all.style.left = "0"; all.style.right = "0"; layout(); all.style.top = `${prefix[groups.length]}px`; } root.append(all); }
        }
        for (const [key, value] of computed.all) if (isFormulaError(value) && addedNotices.size < 20) addedNotices.add(`Summary result ${next.label(key)}: ${value.message}`);
        for (const group of grouped) { if (group.error && addedNotices.size < 20) addedNotices.add(`Grouping ${next.label(next.groupBy!.property)}: ${group.error.message}`); }
        for (const message of addedNotices) next.notices.add(message);
        busy = false; host.el.setAttribute("aria-busy", "false"); return true;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return false;
        busy = false; host.el.setAttribute("aria-busy", "false"); throw e;
      }
    },
    paint(current: Model, rows: readonly Entry[], force = false): boolean {
      if (busy) return !!current.groupBy || current.type === "cards";
      if (!model || rows !== selected || current !== model) return false;
      if (!model.groupBy && model.type !== "cards") return false;
      rememberFocus(); layout();
      model.type === "cards" ? cardPaint(force) : tablePaint(force);
      if (focusedGroup !== undefined) {
        if (document.activeElement === document.body || (document.activeElement instanceof Element && document.activeElement.matches(".bases-b5-toggle"))) [...host.el.querySelectorAll<HTMLButtonElement>(".bases-b5-toggle")].find(b => b.dataset.groupId === focusedGroup)?.focus({ preventScroll: true });
        focusedGroup = undefined;
      }
      showNotices(); return true;
    },
    dispose() { gone = true; clear(); host.scroller.removeEventListener("contextmenu", contextMenu); root.remove(); },
    /** The rows in the order they are drawn, for Copy and Export CSV: by group when grouped. */
    rows: (): readonly Entry[] | null => model?.groupBy ? groups.flatMap(g => g.rows) : null,
  };
}
