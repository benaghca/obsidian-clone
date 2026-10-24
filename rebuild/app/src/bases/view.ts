// A first table view. Only the visible rows have DOM; source YAML
// is read once, and the existing property index supplies changed note metadata.
import { api } from "../api";
import { fits, asType, type PropertyType } from "../editor/frontmatter";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { formatDate } from "../settings/dateFormat";
import { parentDir } from "../paths";
import { propertyValue } from "../editor/properties";
import { TYPE_ICONS } from "../editor/propertyFields";
import { propertyIndex } from "../shell/propertyIndex";
import { vaultTags } from "../shell/vaultTags";
import { tagsInText } from "../shell/linksTags";
import { whereFromEvent, type Group } from "../tabs";
import type { Workspace } from "../workspace";
import { baseMenus } from "./menus";
import { cellEditor } from "./cells";
import { baseModel, noteKey, type Row } from "./model";
import type { Value } from "./expression";

export function createBaseView(ws: Workspace, path: string, group: Group) {
  const el = h("div", { class: "bases-view", tabindex: "0", "aria-label": "Base table" });
  const toolbar = h("div", { class: "bases-toolbar" });
  const notice = h("div", { class: "bases-notice", role: "status" });
  const scroller = h("div", { class: "bases-scroll", tabindex: "0" });
  const columns = h("colgroup");
  const table = h("table", { class: "bases-table", "aria-label": "Results" });
  const head = h("thead"), body = h("tbody");
  table.append(columns, head, body); scroller.append(table); el.append(toolbar, notice, scroller);
  const index = propertyIndex(ws);
  let model: ReturnType<typeof baseModel> | null = null;
  let selected: ReturnType<ReturnType<typeof baseModel>["select"]> = [];
  let source = "", reload = true, gone = false, running = false, dirty = false, timer = 0, frame = 0, start = -1;
  let types = new Map<string, PropertyType>();
  const error = (e: unknown) => { notice.hidden = false; notice.textContent = e instanceof Error ? e.message : String(e); };
  const menus = baseMenus(ws, path, () => model!, () => types, error, async () => { reload = true; await update(); });
  const editing = () => body.contains(document.activeElement) && document.activeElement?.matches('input:not([type="checkbox"]),[contenteditable="plaintext-only"]');
  el.addEventListener("focusout", () => { setTimeout(() => { if (!gone && !editing()) schedule(); }, 0); });
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
  function paint(force = false) {
    if (!model || gone || editing()) return;
    const virtual = selected.length > 200, first = virtual ? Math.min(Math.max(0, selected.length - Math.ceil(scroller.clientHeight / 30)), Math.max(0, Math.floor((scroller.scrollTop - 30) / 30) - 8)) : 0;
    if (!force && first === start) return;
    start = first;
    const end = virtual ? Math.min(selected.length, first + Math.ceil(scroller.clientHeight / 30) + 16) : selected.length;
    const fragment = document.createDocumentFragment();
    const space = (height: number) => {
      if (!height) return;
      const td = h("td", { style: `height:${height}px;padding:0;border:0`, "aria-hidden": "true" });
      td.colSpan = model!.columns.length; fragment.append(h("tr", { class: "bases-spacer" }, td));
    };
    space(first * 30);
    for (let i = first; i < end; i++) fragment.append(h("tr", { "data-path": selected[i].row.file.path }, ...model.columns.map(key => cell(key, selected[i]))));
    space((selected.length - end) * 30);
    body.replaceChildren(fragment);
    notice.textContent = [...model.notices].join(" · "); notice.hidden = !notice.textContent;
  }
  scroller.addEventListener("scroll", () => { frame ||= requestAnimationFrame(() => { frame = 0; paint(); }); }, { passive: true });
  const resize = new ResizeObserver(() => paint(true)); resize.observe(scroller);
  async function update() {
    dirty = true;
    if (running) return;
    running = true;
    try {
      while (dirty && !gone) {
        dirty = false;
        if (reload) { reload = false; source = await api.readNote(path); model = baseModel(source); }
        const properties = await index.notes();
        const needsTags = /file\.(?:tags|hasTag)/.test(source);
        const tags = needsTags ? await vaultTags(ws).read() : new Map<string, string[]>();
        if (gone || dirty) continue;
        if (editing()) { dirty = false; break; }
        types = new Map();
        for (const { props } of properties.values()) for (const p of props) if (!types.has(p.key)) types.set(p.key, index.host.typeOf(p.key) ?? p.type);
        const linkCache = new Map<string, string | null>();
        const rows: Row[] = ws.vault.files.filter(f => !f.is_dir && f.path.endsWith(".md") && !ws.vault.isExcluded(f.path)).map(file => {
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
        });
        selected = model!.select(rows);
        model!.results = selected.length;
        toolbar.replaceChildren(...menus.toolbar());
        table.setAttribute("aria-rowcount", String(selected.length + 1));
        head.replaceChildren(h("tr", null, ...model!.columns.map(key => {
          const sort = model!.sorts.find(s => noteKey(s.property) === noteKey(key));
          return h("th", { "data-property": key, oncontextmenu: (e: MouseEvent) => menus.header(e, key) }, h("div", { class: "bases-header" }, icon(key === "file.name" ? "info" : key.startsWith("formula.") ? "square-function" : TYPE_ICONS[type(key)], 14), h("span", null, model!.label(key)), sort ? icon(sort.direction === 1 ? "chevron-up" : "chevron-down", 14) : null));
        })));
        // Measure the interface font; reserve a sort glyph and native date width.
        const measure = document.createElement("canvas").getContext("2d")!;
        measure.font = `13.125px ${getComputedStyle(table).fontFamily}`;
        columns.replaceChildren(...model!.columns.map((key, i) => {
          const col = h("col");
          if (i < model!.columns.length - 1) {
            const sort = model!.sorts.some(s => noteKey(s.property) === noteKey(key));
            let width = Math.max(key === "file.name" ? 78 : 60, Math.ceil(measure.measureText(model!.label(key)).width + 34 + (sort ? 16 : 0)));
            if (["date", "datetime"].includes(type(key))) width = type(key) === "date" ? 128 : 210;
            if (["tags", "list", "aliases"].includes(type(key))) for (const entry of selected) {
              const v = entry.context.get(key);
              if (Array.isArray(v)) width = Math.max(width, Math.ceil(v.reduce<number>((sum, item) => sum + measure.measureText(String(item)).width + 44, 16)));
            }
            col.style.width = `${width}px`;
          }
          return col;
        }));
        paint(true);
      }
    } catch (error) {
      if (!gone) { model = null; toolbar.textContent = "Unable to open base"; notice.hidden = false; notice.textContent = error instanceof Error ? error.message : String(error); head.replaceChildren(); body.replaceChildren(); }
    } finally { running = false; }
  }
  function schedule() { clearTimeout(timer); timer = window.setTimeout(() => void update(), 20); }
  const unwatch = ws.vault.onModified(changed => { if (changed === path) reload = true; schedule(); });
  const off = ws.on(change => { if (["files", "doc", "links"].includes(change)) schedule(); });
  void update();
  return { el, dispose() { gone = true; menus.dispose(); unwatch(); off(); resize.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); el.remove(); } };
}
