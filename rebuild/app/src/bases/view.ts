// A base's view: its toolbar and its table (or, through groups.ts, its cards and groups), drawn in a
// tab (createBaseView) or in a note (embed.ts). Only the visible rows have DOM;
// source YAML is read once, and the existing property index supplies changed note metadata.
import { api, type FileEntry } from "../api";
import { fits, asType, type PropertyType } from "../editor/frontmatter";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { formatDate } from "../settings/dateFormat";
import { isNoteFile, isUnder, noteName, parentDir, trimSlashes } from "../paths";
import { propertyValue } from "../editor/properties";
import { TYPE_ICONS } from "../editor/propertyFields";
import { propertyIndex } from "../shell/propertyIndex";
import { vaultTags } from "../shell/vaultTags";
import { tagsInText } from "../shell/linksTags";
import { whereFromEvent, type Group, type Tab } from "../tabs";
import type { Workspace } from "../workspace";
import { baseMenus, type BaseFile } from "./menus";
import { createCardGrid } from "./cards";
import { createKanban } from "./kanban";
import { columnControls } from "./columns";
import { cellEditor } from "./cells";
import { baseModel, baseNoteFiles, noteKey, propertyId, type Row } from "./model";
import type { Value } from "./expression";
import { mapping, readYaml, type Yaml } from "./yaml";
import { createGroupedView, runSliced, type Entry } from "./groups";
import { searchWork, rowText } from "./search";
import { settings } from "../settings/store";

/** How long a burst of typing waits before the open base rebuilds. Matches the note save delay. */
const DOC_QUIET_MS = 300;
const SOON_MS = 20;

export interface BaseNeeds { folders: string[]; tags: string[] }

/** Folder and tag facts an AND filter requires. An OR or NOT adds none: those are not safe to skip. */
export function baseNeeds(source: string, viewIndex: number): BaseNeeds {
  const root = readYaml(source);
  const views = Array.isArray(root.views) && root.views.length ? root.views : [{}];
  const view = mapping(views[Math.max(0, Math.min(viewIndex, views.length - 1))]);
  const global = gatherNeeds(root.filters);
  const local = gatherNeeds(view.filters);
  return { folders: [...global.folders, ...local.folders], tags: [...global.tags, ...local.tags] };
}

function gatherNeeds(filter: Yaml | undefined): BaseNeeds {
  if (typeof filter === "string") return needsFromExpr(filter);
  if (filter == null || typeof filter !== "object" || Array.isArray(filter)) return { folders: [], tags: [] };
  const entries = Object.entries(filter);
  if (entries.length !== 1 || !Array.isArray(entries[0][1]) || entries[0][0] !== "and") return { folders: [], tags: [] };
  const need: BaseNeeds = { folders: [], tags: [] };
  for (const child of entries[0][1] as Yaml[]) {
    const part = gatherNeeds(child);
    need.folders.push(...part.folders);
    need.tags.push(...part.tags);
  }
  return need;
}

/** Top-level `&&` parts, ignoring `&&` inside quotes or parentheses. */
function andParts(expr: string): string[] {
  const parts: string[] = [];
  let start = 0, depth = 0, quote = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") { if (--depth < 0) return []; }
    else if (depth === 0 && expr.startsWith("||", i)) return [];
    else if (depth === 0 && expr.startsWith("&&", i)) {
      parts.push(expr.slice(start, i).trim());
      i += 1;
      start = i + 1;
    }
  }
  if (quote || depth) return [];
  parts.push(expr.slice(start).trim());
  return parts.filter(Boolean);
}

function callArg(expr: string, name: string): string | null {
  const match = new RegExp(`^${name.replaceAll(".", "\\.")}\\(\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\s*\\)$`).exec(expr);
  if (!match) return null;
  const token = match[1];
  if (token[0] === '"') {
    try {
      const value = JSON.parse(token);
      return typeof value === "string" ? value : null;
    } catch { return null; }
  }
  return token.slice(1, -1).replace(/\\(['\\])/g, "$1");
}

function needsFromExpr(expr: string): BaseNeeds {
  const need: BaseNeeds = { folders: [], tags: [] };
  for (const part of andParts(expr)) {
    const folder = callArg(part, "file.inFolder");
    if (folder !== null) {
      const trimmed = trimSlashes(folder);
      if (trimmed) need.folders.push(trimmed);
      continue;
    }
    const tag = callArg(part, "file.hasTag");
    if (tag !== null) {
      const trimmed = tag.replace(/^#/, "");
      if (trimmed) need.tags.push(trimmed);
    }
  }
  return need;
}

/**
 * True when `path` cannot be a row of this base, or already isn't and still
 * fails a required tag. Typing cannot move a file into a folder. A missing
 * tag is only decisive when the row is not already on screen (adding the tag,
 * or removing it from a visible row, still rebuilds).
 */
export function missesPrefilter(path: string, need: BaseNeeds, text: string | null, visible: boolean): boolean {
  if (!need.folders.length && !need.tags.length) return false;
  if (need.folders.some(folder => !isUnder(parentDir(path), folder))) return true;
  if (!need.tags.length) return false;
  if (text === null) return false;
  const tags = tagsInText(text);
  const has = (want: string) => tags.some(tag => {
    const name = tag.replace(/^#/, "");
    return name === want || name.startsWith(`${want}/`);
  });
  if (need.tags.every(has)) return false;
  return !visible;
}

/** Every changed note is outside the base's folder/tag pre-filter, when that filter is readable. */
export function docsOutsideFilter(paths: readonly string[], source: string, viewIndex: number, textOf: (path: string) => string | null, visible: (path: string) => boolean, previousTextOf: (path: string) => string | null = () => null): boolean {
  if (!paths.length || !source) return false;
  let need: BaseNeeds;
  try { need = baseNeeds(source, viewIndex); } catch { return false; }
  // A tag removal can change the total even when the row was beyond the view limit.
  return paths.every(path => missesPrefilter(path, need, textOf(path), visible(path)) && missesPrefilter(path, need, previousTextOf(path), visible(path)));
}

/** The base reads `this` and the note it is changed: that rebuilds even when the note is outside the base's folder or tag. */
export const readsChanged = (source: string, host: string | null, changed: readonly string[]) => host !== null && changed.includes(host) && /\bthis\b/.test(source);

export interface BaseChange {
  change: string;
  shown: boolean;
  deferred: boolean;
  /** Notes whose text just changed, or null when this event isn't a known edit. */
  changed: string[] | null;
  /** Every path in `changed` is outside the pre-filter. */
  outside: boolean;
  pending?: boolean;
}

export interface BaseRefresh {
  deferred: boolean;
  /** Wait this long, then rebuild. Null leaves any pending rebuild as it is. */
  delay: number | null;
  /** Cancel a rebuild that was waiting because the base is hidden. */
  clear: boolean;
}

/** Doc edits wait out a quiet period. A hidden base waits until it is shown. An outside edit is skipped. */
export function baseChange(input: BaseChange): BaseRefresh {
  const watch = input.change === "files" || input.change === "doc" || input.change === "links";
  const reveal = input.change === "show" || input.change === "pane" || input.change === "tabs";
  if (reveal) {
    if (!input.shown) return { deferred: input.deferred || !!input.pending, delay: null, clear: true };
    if (input.deferred && input.shown) return { deferred: false, delay: SOON_MS, clear: false };
    return { deferred: input.deferred, delay: null, clear: false };
  }
  if (!watch) return { deferred: input.deferred, delay: null, clear: false };
  if (!input.shown) return { deferred: true, delay: null, clear: true };
  if (input.change === "doc") {
    if (input.changed && input.changed.length > 0 && input.outside) return { deferred: false, delay: input.deferred ? SOON_MS : null, clear: false };
    return { deferred: false, delay: DOC_QUIET_MS, clear: false };
  }
  return { deferred: false, delay: SOON_MS, clear: false };
}

/** A .base file as the place a base's YAML is read from and written to. */
export const baseFile = (ws: Workspace, path: string): BaseFile => ({
  read: () => api.readNote(path),
  async write(text) { await api.writeNote(path, text); ws.vault.written(path); },
});

export interface BaseOptions {
  group: Group;
  file: BaseFile;
  /** The file whose change on disk reloads the YAML (the .base file); none for a ```base block. */
  watch?: string;
  /** The note `this` reads. A function is resolved on each evaluation (B4-FIX: the embed host can be renamed). */
  host: string | null | (() => string | null);
  viewIndex: number;
  /** The view shown first, by name (![[X.base#View]]), when there is one. */
  viewName?: string;
  /** Whether it is showing, besides being in the document: a hidden base waits until it is shown (B0). */
  shown?(): boolean;
  /** The view shown changed. */
  remember?(index: number): void;
}

/**
 * A base's toolbar and its table or cards: the tab's content (createBaseView),
 * and what a note draws for a ```base block or ![[X.base]] (embed.ts).
 * Rows are built and filtered again only through `schedule` (B0's rules).
 */
export function createBase(ws: Workspace, o: BaseOptions) {
  const { group, file } = o;
  // K3: collapsed groups live on the tab the base is drawn in (its own, or the note's for an embed), never in the YAML.
  const tab = group.active, collapsedHere = collapsedByTab.get(tab) ?? new Map<string, Set<string>>();
  collapsedByTab.set(tab, collapsedHere);
  // B4-FIX: one path for this evaluation, read again next time. A string is the tab's own file.
  const hostPath = (): string | null => (typeof o.host === "function" ? o.host() : o.host) ?? null;
  let viewIndex = o.viewIndex, viewName = o.viewName;
  const el = h("div", { class: "bases-view", tabindex: "0", "aria-label": "Base table" });
  const toolbar = h("div", { class: "bases-toolbar" });
  const notice = h("div", { class: "bases-notice", role: "status" });
  const scroller = h("div", { class: "bases-scroll", tabindex: "0" });
  const columns = h("colgroup");
  const table = h("table", { class: "bases-table", "aria-label": "Results" });
  const head = h("thead"), body = h("tbody");
  table.append(columns, head, body); scroller.append(table); el.append(toolbar, notice, scroller);
  const index = propertyIndex(ws);
  let model: ReturnType<typeof baseModel> | null = null, host: Row | undefined;
  let selected: ReturnType<ReturnType<typeof baseModel>["select"]> = [];
  // B6: the toolbar Search box narrows the selected rows (after the limit) to `drawn`: the rows painted, counted, summarised and copied.
  let drawn: readonly Entry[] = [], query = "", searchRun = 0, requery = false;
  // What `drawn` was filtered from, and by which (lower-case) query: a longer query narrows `drawn` instead of every row.
  let drawnFrom: readonly Entry[] = [], drawnQuery = "";
  const searchText = new WeakMap<Entry, string>();
  const textOf = (entry: Entry) => {
    let text = searchText.get(entry);
    if (text === undefined) searchText.set(entry, text = rowText(entry.context, model!.columns, cards() || kanban() ? noteName(entry.row.file.path) : undefined));
    return text;
  };
  /** The drawn rows for the current query, or null when cancelled. */
  const searched = async (rows: readonly Entry[], cancelled: () => boolean) => {
    try { return await runSliced(searchWork(rows, query, textOf), { cancelled }); }
    catch (e) { if (e instanceof Error && e.name === "AbortError") return null; throw e; }
  };
  let types = new Map<string, PropertyType>(), inferred = new Map<string, PropertyType>();
  let source = "", reload = true, gone = false, running = false, dirty = false, timer = 0, frame = 0, start = -1;
  const cards = () => model?.type === "cards", kanban = () => model?.type === "kanban";
  const error = (e: unknown) => { notice.hidden = false; notice.textContent = e instanceof Error ? e.message : String(e); };
  const menus = baseMenus(ws, file, () => model!, () => types, error, async (index?: number) => { if (index !== undefined) { viewIndex = index; o.remember?.(index); scroller.scrollTop = 0; } reload = true; await update(); }, () => (layout().rows() ?? drawn).map(entry => model!.columns.map(key => entry.context.get(key))), next => { query = next; void refilter(); }, key => inferred.get(noteKey(key)) ?? "text", { groups: () => layout().groups(), hiddenRows: () => layout().hiddenRows() });
  /** Draw the toolbar's buttons, once: moving them would blur the Search box. */
  const drawToolbar = () => { const items = menus.toolbar(); if (items.some((item, i) => toolbar.children[i] !== item)) toolbar.replaceChildren(...items); };
  let automatic: number[] = [];
  function applySizes(key?: string, width?: number) {
    if (!model || !automatic.length) return;
    const widths=model.columns.map((column,i)=>{
      const id=propertyId(column), saved=column===key?width:Object.hasOwn(model!.sizes,id)?model!.sizes[id]:model!.sizes[column];
      return saved === undefined ? automatic[i] : Math.max(40,Number.isFinite(Number(saved))?Number(saved):40);
    });
    const last=model.columns.length-1, lastKey=model.columns[last];
    if(last>=0 && lastKey!==key && model.sizes[propertyId(lastKey)]===undefined && model.sizes[lastKey]===undefined) widths[last]=Math.max(widths[last],scroller.clientWidth-1-widths.slice(0,last).reduce((sum,n)=>sum+n,0));
    [...columns.children].forEach((col,i)=>(col as HTMLElement).style.width=`${widths[i]}px`);
    table.style.width=`${widths.reduce((sum,n)=>sum+n,0)}px`;
  }
  const controls=columnControls(head,applySizes,(key,width)=>menus.size(key,width),change=>menus.order(change),schedule);
  const field = (node: EventTarget | null) => node instanceof Element && body.contains(node) && node.matches('input:not([type="checkbox"]),[contenteditable="plaintext-only"]');
  const editing = () => controls.active || field(document.activeElement);
  // Work out the rows' text while the Search box is focused, before the first key.
  toolbar.addEventListener("focusin", e => {
    if (!(e.target as Element).matches(".bases-search-input") || !model) return;
    const rows = selected;
    void runSliced((function* () { for (let i = 0; i < rows.length; i++) { textOf(rows[i]); if ((i & 255) === 255) yield; } })(), { cancelled: () => gone || running || rows !== selected }).catch(() => {});
  });
  // Leaving a cell's field catches up on rebuilds held back while it had focus; other focus moves (Search, toolbar buttons) change no rows.
  el.addEventListener("focusout", e => { if (field(e.target)) setTimeout(() => { if (!gone && !editing()) schedule(); }, 0); });
  function type(key: string, value?: Value): PropertyType {
    if (key === "file.mtime" || key === "file.ctime") return "datetime";
    if (key === "file.tags") return "tags";
    if (key === "file.size" || typeof value === "number") return "number";
    return types.get(noteKey(key)) ?? (Array.isArray(value) ? "list" : typeof value === "boolean" ? "checkbox" : "text");
  }
  function cell(key: string, entry: typeof selected[number]) {
    let value = entry.context.get(key);
    const p = entry.row.props.find(p => p.key === noteKey(key)), want = index.host.typeOf(noteKey(key));
    if (p && want && fits(p, want)) value = asType(p, want);
    const kind = type(key, value), td = h("td", { "data-property": key, "data-value": value === null ? "" : String(value), "data-type": kind });
    if (!/^(file|formula)\./.test(key) && kind !== "unknown") {
      td.classList.add("property"); td.tabIndex = -1;
      td.append(cellEditor(ws, group, entry.row.file.path, key, kind, p, schedule, error));
      // A click anywhere in an empty/text cell places the caret in its value.
      td.addEventListener("mousedown", e => {
        if (e.target !== td) return;
        const field = td.querySelector<HTMLElement>('[contenteditable],input');
        if (field) { e.preventDefault(); field.focus(); }
      });
      return td;
    }
    if (value === null || value === "") return td;
    if (key === "file.name") {
      const open = (e: MouseEvent) => { e.preventDefault(); void ws.open(entry.row.file.path, { where: e.button === 1 ? "tab" : whereFromEvent(e), group }); };
      const link = h("a", { class: "internal-link", onclick: open, onauxclick: (e: MouseEvent) => { if (e.button === 1) open(e); } }, String(value));
      link.href = entry.row.file.path; td.append(link);
    } else if (kind === "date" || kind === "datetime") {
      const text = /Z$/.test(String(value)) ? formatDate(new Date(String(value)), "YYYY-MM-DDTHH:mm:ss") : String(value);
      const field = propertyValue(ws.editors.viewOf(group), {key, type:kind, value:text, line:0, count:0}, () => {});
      field.querySelectorAll("input").forEach(input => {input.readOnly = true; input.tabIndex = -1;});
      td.classList.add("bases-file-date"); td.append(field);
    } else if (typeof value === "boolean") {
      const checkbox = h("input", { type: "checkbox", "aria-label": model!.label(key) });
      checkbox.checked = value; checkbox.disabled = true; td.append(checkbox);
    } else if (Array.isArray(value)) {
      for (const item of value) td.append(h("span", { class: "property-pill is-tag" }, String(item)));
    } else td.textContent = String(value);
    return td;
  }
  // Cards, and tables with groups or summaries, are drawn by groups.ts; a plain table is drawn below.
  const groupedView = createGroupedView({ el, scroller, table, body, ws, group, cell, header: menus.header, createCards: createCardGrid, repaint: () => paint(true), summaryContext: () => host && model?.hostContext(host),
    collapsed: scope => { const key = `${o.watch ?? `block:${hostPath() ?? ""}`}\0${scope}`; let set = collapsedHere.get(key); if (!set) collapsedHere.set(key, set = new Set()); return set; },
    groupMenu: (event, g) => menus.groupHeading(event, g) });
  // K4: a Kanban view is drawn by the board, beside the scroller; table and cards by groupedView.
  const board = createKanban({ ws, group, groupHost: () => menus.groupHost, scope: () => o.watch ?? `block:${hostPath() ?? ""}`, count: value => { if (model) { model.results = value; drawToolbar(); } }, matches: entry => !query || query.toLowerCase().split(/\s+/).filter(Boolean).every(term => rowText(entry.context, model!.columns, noteName(entry.row.file.path)).includes(term)), openGroupMenu: () => toolbar.querySelector<HTMLElement>('[aria-label="Group"]')?.click(), error });
  el.append(board.el);
  const layout = () => kanban() ? board : groupedView;
  /** Rows in hidden groups are not counted (D7). The last hidden total is only a stand-in until grouping finishes, and it must not drive the count below zero. */
  const shownCount = () => Math.max(0, drawn.length - layout().hiddenRows());
  const counted = () => { if (!model) return; model.results = shownCount(); if (!cards()) table.setAttribute("aria-rowcount", String(model.results + 1)); drawToolbar(); };
  function paint(force = false) {
    if (!model || gone || editing()) return;
    if (layout().paint(model, drawn, force) || cards() || kanban()) return;
    const rowHeight=model.rowHeight, virtual = drawn.length > 200, first = virtual ? Math.min(Math.max(0, drawn.length - Math.ceil(scroller.clientHeight / rowHeight)), Math.max(0, Math.floor((scroller.scrollTop - 30) / rowHeight) - 8)) : 0;
    if (!force && first === start) return;
    start = first;
    const end = virtual ? Math.min(drawn.length, first + Math.ceil(scroller.clientHeight / rowHeight) + 16) : drawn.length;
    const fragment = document.createDocumentFragment();
    const space = (height: number) => {
      if (!height) return;
      const td = h("td", { style: `height:${height}px;padding:0;border:0`, "aria-hidden": "true" });
      td.colSpan = model!.columns.length; fragment.append(h("tr", { class: "bases-spacer" }, td));
    };
    space(first * rowHeight);
    for (let i = first; i < end; i++) fragment.append(h("tr", { "data-path": drawn[i].row.file.path }, ...model.columns.map(key => cell(key, drawn[i]))));
    space((drawn.length - end) * rowHeight);
    body.replaceChildren(fragment);
    notice.textContent = [...model.notices].join(" · "); notice.hidden = !notice.textContent;
  }
  scroller.addEventListener("scroll", () => { frame ||= requestAnimationFrame(() => { frame = 0; paint(); }); }, { passive: true });
  const resize = new ResizeObserver(() => { if(!cards()&&!controls.active)applySizes();paint(true); }); resize.observe(scroller);
  async function update() {
    dirty = true;
    if (running) return;
    running = true;
    try {
      while (dirty && !gone) {
        dirty = false;
        await board.idle(); if (gone) break;
        if (reload || !model) {
          reload = false; source = await file.read(); model = baseModel(source, viewIndex);
          // ![[X.base#View]] picks its view by name once; later the toolbar's choice stands.
          const named = viewName === undefined ? -1 : model.views.findIndex(v => mapping(v).name === viewName);
          viewName = undefined;
          if (named >= 0 && named !== model.viewIndex) model = baseModel(source, named);
          viewIndex = model.viewIndex; o.remember?.(viewIndex);
        }
        const properties = await index.notes();
        const needsTags = /file\.(?:tags|hasTag)/.test(source);
        const tags = needsTags ? await vaultTags(ws).read() : new Map<string, string[]>();
        if (gone || dirty) continue;
        if (editing()) { dirty = false; break; }
        types = new Map(); inferred = new Map();
        for (const { props } of properties.values()) for (const p of props) if (!types.has(p.key)) { types.set(p.key, index.host.typeOf(p.key) ?? p.type); inferred.set(p.key, p.type); }
        const linkCache = new Map<string, string | null>();
        const row = (file: FileEntry): Row => {
          const props = properties.get(file.path)?.props ?? [];
          let allTags = tags.get(file.path) ?? props.filter(p => p.type === "tags").flatMap(p => Array.isArray(p.value) ? p.value : [String(p.value)]);
          // Loaded notes include unsaved tags, using the same fenced-code-aware reader as the Tags view.
          if (needsTags && ws.editors.isLoaded(file.path)) {
            allTags = tagsInText(ws.editors.doc(file.path)!.toString());
          }
          return { file, props, tags: allTags, hasLink: link => {
            const cacheKey = `${parentDir(file.path)}\0${link}`;
            if (!linkCache.has(cacheKey)) linkCache.set(cacheKey, ws.resolve(link.replace(/^\[\[|\]\]$/g, ""), file.path));
            const target = linkCache.get(cacheKey), links = ws.vault.links;
            return !!target && [...links.outgoing[file.path] ?? [], ...links.markdown?.[file.path] ?? []].includes(target);
          } };
        };
        const rows = baseNoteFiles(ws.vault.files, (path) => ws.vault.isExcluded(path)).map(row);
        // `this`, when the YAML reads it: its note's row (a copy, so its context has no `this` of its own), or any file's, such as the .base itself.
        const hostNow = hostPath();
        const hostFile = hostNow === null || !/\bthis\b/.test(source) ? undefined : rows.find(r => r.file.path === hostNow)?.file ?? ws.vault.files.find(f => f.path === hostNow);
        host = hostFile && row(hostFile);
        if (host) for (const r of rows) r.host = host;
        const matches = model!.select(rows,true);model!.total=matches.length;
        selected = typeof model!.view.limit === "number" ? matches.slice(0,model!.view.limit) : matches;
        const found = query ? await searched(selected, () => gone || dirty) : selected;
        if (!found) continue;
        drawn = found; drawnFrom = selected; drawnQuery = query.toLowerCase();
        model!.results = shownCount();table.style.setProperty("--bases-row-height",`${model!.rowHeight}px`);
        drawToolbar();
        const glyph = cards() ? "grid-2x2" : kanban() ? "square-kanban" : "table", svg = toolbar.querySelector(".bases-view-name svg");
        if (svg && !svg.classList.contains(`lucide-${glyph}`)) svg.replaceWith(icon(glyph));
        table.hidden = cards(); scroller.hidden = kanban(); board.el.hidden = !kanban(); el.setAttribute("aria-label", cards() ? "Base cards" : kanban() ? "Base board" : "Base table");
        if (kanban()) {
          head.replaceChildren(); body.replaceChildren(); start = -1; groupedView.clear();
          if (await board.update(model!, drawn, types, () => gone || dirty, selected, properties)) { counted(); paint(true); }
          continue;
        }
        board.clear();
        if (cards()) {
          head.replaceChildren(); body.replaceChildren(); start = -1;
          if (await groupedView.update(model!, drawn, types, () => gone || dirty)) { counted(); paint(true); }
          continue;
        }
        table.setAttribute("aria-rowcount", String(drawn.length + 1));
        head.replaceChildren(h("tr", null, ...model!.columns.map(key => {
          const sort = model!.sorts.find(s => noteKey(s.property) === noteKey(key));
          const th = h("th", { "data-property": key, oncontextmenu: (e: MouseEvent) => menus.header(e, key) }, h("div", { class: "bases-header" }, icon(key === "file.name" ? "info" : key.startsWith("formula.") ? "square-function" : TYPE_ICONS[type(key)], 14), h("span", null, model!.label(key)), sort ? icon(sort.direction === 1 ? "chevron-up" : "chevron-down", 14) : null));
          controls.attach(th,key);return th;
        })));
        // Measure the interface font; reserve a sort glyph and native date width.
        const measure = document.createElement("canvas").getContext("2d")!;
        measure.font = `13.125px ${getComputedStyle(table).fontFamily}`;
        automatic = model!.columns.map(key => {
            const sort = model!.sorts.some(s => noteKey(s.property) === noteKey(key));
            let width = Math.max(key === "file.name" ? 78 : 60, Math.ceil(measure.measureText(model!.label(key)).width + 34 + (sort ? 16 : 0)));
            if (["date", "datetime"].includes(type(key))) width = type(key) === "date" ? 128 : 210;
            if (["tags", "list", "aliases"].includes(type(key))) for (const entry of selected) {
              const v = entry.context.get(key);
              if (Array.isArray(v)) width = Math.max(width, Math.ceil(v.reduce<number>((sum, item) => sum + measure.measureText(String(item)).width + 44, 16)));
            }
            return width;
        });
        columns.replaceChildren(...model!.columns.map(()=>h("col")));applySizes();
        if (!await groupedView.update(model!, drawn, types, () => gone || dirty)) continue;
        counted(); paint(true);
      }
    } catch (error) {
      if (!gone) { model = null; groupedView.clear(); board.clear(); toolbar.textContent = "Unable to open base"; notice.hidden = false; notice.textContent = error instanceof Error ? error.message : String(error); head.replaceChildren(); body.replaceChildren(); }
    } finally {
      running = false;
      if (requery && !gone) { requery = false; void refilter(); }
    }
  }
  /** The query changed: filter the rows already selected again, without evaluating the base. */
  async function refilter() {
    if (!model || running) { requery = true; return; }
    const run = ++searchRun, stale = () => gone || running || run !== searchRun, lower = query.toLowerCase();
    const narrows = drawnFrom === selected && drawnQuery !== "" && lower.startsWith(drawnQuery);
    const found = await searched(narrows ? drawn : selected, stale);
    if (!found || stale() || !model) return;
    const same = drawnFrom === selected && found.length === drawn.length && found.every((entry, i) => entry === drawn[i]);
    drawnFrom = selected; drawnQuery = lower;
    // The same rows (most keys while a query is still short): nothing to draw again.
    if (same) return;
    drawn = found; model.results = shownCount(); drawToolbar();
    scroller.scrollTop = 0; start = -1;
    if (kanban()) { board.top(); if (await board.update(model, drawn, types, stale, selected)) { counted(); paint(true); } return; }
    if (!cards()) table.setAttribute("aria-rowcount", String(drawn.length + 1));
    if (await groupedView.update(model, drawn, types, stale)) { counted(); paint(true); }
  }
  let deferred = false;
  const shown = () => el.isConnected && (o.shown?.() ?? true);
  function schedule(delay = SOON_MS) {
    clearTimeout(timer); timer = 0;
    if (!shown()) { deferred = true; return; }
    timer = window.setTimeout(() => {
      timer = 0;
      if (!shown()) { deferred = true; return; }
      deferred = false;
      void update();
    }, delay);
  }
  const openTexts = () => {
    const out = new Map<string, string>();
    for (const pane of ws.groups()) {
      const note = pane.active.path;
      if (!note || !isNoteFile(note) || !ws.editors.isLoaded(note)) continue;
      const text = ws.editors.doc(note)?.toString();
      if (text !== undefined) out.set(note, text);
    }
    return out;
  };
  let docSnap = openTexts();
  // Keep the text before the first unsaved edit until its save notification.
  const changedFrom = new Map<string, string | null>();
  const changedNotes = () => {
    const next = openTexts();
    const changed: string[] = [];
    for (const [note, text] of next) if (docSnap.get(note) !== text) {
      changed.push(note);
      if (!changedFrom.has(note)) changedFrom.set(note, docSnap.get(note) ?? null);
    }
    docSnap = next;
    return changed.length ? changed : null;
  };
  const outside = (changed: string[], before: (note: string) => string | null) => !readsChanged(source, hostPath(), changed) && docsOutsideFilter(changed, source, viewIndex,
    note => ws.editors.isLoaded(note) ? ws.editors.doc(note)?.toString() ?? null : null,
    note => selected.some(entry => entry.row.file.path === note), before);
  const unwatch = ws.vault.onModified(changed => {
    const before = changedFrom.get(changed) ?? null;
    changedFrom.delete(changed);
    if (changed === o.watch) reload = true;
    else if (isNoteFile(changed) && outside([changed], () => before)) return;
    schedule();
  });
  const off = ws.on(change => {
    const changed = change === "doc" && shown() ? changedNotes() : null;
    const next = baseChange({
      change,
      shown: shown(),
      deferred,
      pending: timer !== 0,
      changed,
      outside: !!changed && outside(changed, note => changedFrom.get(note) ?? null),
    });
    deferred = next.deferred;
    if (next.delay !== null) {
      schedule(next.delay);
      if (change === "show" || change === "pane" || change === "tabs") docSnap = openTexts();
    } else if (next.clear) { clearTimeout(timer); timer = 0; }
  });
  // A new Property type (header menu, Properties view) changes cells and icons.
  const unsettle = settings.on(file => { if (file === "types.json" || file === null) schedule(); });
  void update();
  return {
    el,
    /** Read the YAML again (a ```base block's text changed). */
    reload() { reload = true; schedule(); },
    dispose() { gone = true; controls.dispose(); menus.dispose(); groupedView.dispose(); board.dispose(); unwatch(); off(); unsettle(); resize.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); el.remove(); },
  };
}

const viewsByTab = new WeakMap<Tab, Map<string, number>>();
const collapsedByTab = new WeakMap<Tab, Map<string, Set<string>>>();
/** A .base file in its own tab: `this` is the base file itself, and the tab remembers the view shown. */
export function createBaseView(ws: Workspace, path: string, group: Group) {
  const tab = group.active;
  if (!viewsByTab.has(tab)) viewsByTab.set(tab, new Map());
  const memory = viewsByTab.get(tab)!;
  return createBase(ws, { group, file: baseFile(ws, path), watch: path, host: path, viewIndex: memory.get(path) ?? 0, remember: index => memory.set(path, index), shown: () => group.active === tab });
}
