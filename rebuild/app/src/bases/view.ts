// A read-only first table view. Only the visible rows have DOM; source YAML
// is read once, and the existing property index supplies changed note metadata.
import { api } from "../api";
import { fits, asType, type PropertyType } from "../editor/frontmatter";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { formatDate } from "../settings/dateFormat";
import { parentDir } from "../paths";
import { TYPE_ICONS } from "../editor/propertyFields";
import { propertyIndex } from "../shell/propertyIndex";
import { vaultTags } from "../shell/vaultTags";
import { tagsInText } from "../shell/linksTags";
import { whereFromEvent, type Group } from "../tabs";
import type { Workspace } from "../workspace";
import { baseModel, noteKey, type Row } from "./model";
import type { Value } from "./expression";

export function createBaseView(ws: Workspace, path: string, group: Group) {
  const el = h("div", { class: "bases-view", tabindex: "0", "aria-label": "Base table" });
  const toolbar = h("div", { class: "bases-toolbar" });
  const notice = h("div", { class: "bases-notice", role: "status" });
  const scroller = h("div", { class: "bases-scroll", tabindex: "0" });
  const table = h("table", { class: "bases-table", "aria-label": "Results" });
  const head = h("thead"), body = h("tbody");
  table.append(head, body); scroller.append(table); el.append(toolbar, notice, scroller);
  const index = propertyIndex(ws);
  let model: ReturnType<typeof baseModel> | null = null;
  let selected: ReturnType<ReturnType<typeof baseModel>["select"]> = [];
  let source = "", reload = true, gone = false, running = false, dirty = false, timer = 0, frame = 0, start = -1;
  let types = new Map<string, PropertyType>();
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
    if (value === null || value === "") return td;
    if (key === "file.name") {
      const open = (e: MouseEvent) => { e.preventDefault(); void ws.open(entry.row.file.path, { where: e.button === 1 ? "tab" : whereFromEvent(e), group }); };
      const link = h("a", { class: "internal-link", onclick: open, onauxclick: (e: MouseEvent) => { if (e.button === 1) open(e); } }, String(value));
      link.href = entry.row.file.path; td.append(link);
    } else if (kind === "date" || kind === "datetime") {
      const input = h("input", { class: "property-input", type: kind === "date" ? "date" : "datetime-local", tabindex: "-1", "aria-label": model!.label(key) });
      input.readOnly = true; input.step = "1";
      input.value = /Z$/.test(String(value)) ? formatDate(new Date(String(value)), "YYYY-MM-DDTHH:mm:ss") : String(value);
      td.append(h("span", { class: "bases-date" }, icon("calendar", 14), input));
    } else if (typeof value === "boolean") {
      const checkbox = h("input", { type: "checkbox", "aria-label": model!.label(key) });
      checkbox.checked = value; checkbox.disabled = true; td.append(checkbox);
    } else if (Array.isArray(value)) {
      for (const item of value) td.append(h("span", { class: "bases-pill" }, String(item)));
    } else td.textContent = String(value);
    return td;
  }
  function paint(force = false) {
    if (!model || gone) return;
    const virtual = selected.length > 200, first = virtual ? Math.max(0, Math.floor((scroller.scrollTop - 30) / 30) - 8) : 0;
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
        const tags = /file\.(?:tags|hasTag)/.test(source) ? await vaultTags(ws).read() : new Map<string, string[]>();
        if (gone || dirty) continue;
        types = new Map();
        for (const { props } of properties.values()) for (const p of props) if (!types.has(p.key)) types.set(p.key, index.host.typeOf(p.key) ?? p.type);
        const linkCache = new Map<string, string | null>();
        const rows: Row[] = ws.vault.files.filter(f => !f.is_dir && f.path.endsWith(".md") && !ws.vault.isExcluded(f.path)).map(file => {
          const props = properties.get(file.path)?.props ?? [];
          let allTags = tags.get(file.path) ?? props.filter(p => p.type === "tags").flatMap(p => Array.isArray(p.value) ? p.value : [String(p.value)]);
          // Loaded notes include unsaved tags, using the same fenced-code-aware reader as the Tags view.
          if (tags.size && ws.editors.isLoaded(file.path)) {
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
        toolbar.replaceChildren(h("span", { class: "bases-view-name" }, model!.name, icon("chevron-down", 14)), h("span", { class: "bases-count" }, `${selected.length} results`));
        table.setAttribute("aria-rowcount", String(selected.length + 1));
        head.replaceChildren(h("tr", null, ...model!.columns.map(key => {
          const sort = model!.sorts.find(s => noteKey(s.property) === noteKey(key));
          return h("th", { "data-property": key }, h("div", { class: "bases-header" }, icon(TYPE_ICONS[type(key)], 14), h("span", null, model!.label(key)), sort ? icon(sort.direction === 1 ? "arrow-up" : "arrow-down", 12) : null));
        })));
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
  return { el, dispose() { gone = true; unwatch(); off(); resize.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); el.remove(); } };
}
