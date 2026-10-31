// List layout (KANBAN_PLAN K8). Public help, 2026-10-30, cited in NOTES_KANBAN-K8.md:
// the Views page (bulleted or numbered markers; collapse on table, cards and list),
// the List view page (bullets, numbers or none; a comma separates inline properties),
// and the Bases view plugin guide (the note name is a link; other values follow a separator).
// Heights here match styles/bases-list.css. Nothing is measured while scrolling.
import "../styles/bases-list.css";
import type { PropertyType } from "../editor/frontmatter";
import { noteName } from "../paths";
import { h, pressable } from "../shell/dom";
import { icon } from "../shell/icons";
import { whereFromEvent, type Group } from "../tabs";
import type { Workspace } from "../workspace";
import { displayValue, isFormulaError } from "./functions";
import { arrangeGroups, groupRowsAsync, parseManual, type Entry, type RowGroup } from "./groups";
import { baseModel } from "./model";

type Model = ReturnType<typeof baseModel>;

/** Keep these in step with .bases-list-item and .bases-b5-toggle. */
export const LIST_ROW = 28;
export const LIST_HEADER = 32;

export interface ListUnit {
  group: number;
  kind: "heading" | "row";
  /** Index within the group. A heading is -1. */
  index: number;
  top: number;
}

/**
 * The rows and headings that intersect the viewport, plus a few rows past each edge.
 * Group `counts[i]` is collapsed when `grouped` and `collapsed[i]`. One flat run is
 * `grouped: false` and a single count.
 */
export function listLayout(input: {
  counts: readonly number[];
  collapsed?: readonly boolean[];
  grouped: boolean;
  scrollTop: number;
  height: number;
  overscan?: number;
}): { total: number; units: ListUnit[] } {
  const n = input.counts.length;
  const grouped = input.grouped && n > 0;
  const over = Math.max(0, input.overscan ?? 8) * LIST_ROW;
  const scrollTop = Math.max(0, input.scrollTop || 0);
  const height = input.height > 0 ? input.height : 600;
  const starts = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const shut = grouped && !!input.collapsed?.[i];
    const rows = Math.max(0, input.counts[i] || 0);
    starts[i + 1] = starts[i] + (grouped ? LIST_HEADER : 0) + (shut ? 0 : rows * LIST_ROW);
  }
  const total = starts[n];
  const top = Math.max(0, scrollTop - over);
  const bottom = scrollTop + height + over;
  const units: ListUnit[] = [];
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid + 1] <= top) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < n && starts[i] < bottom; i++) {
    const shut = grouped && !!input.collapsed?.[i];
    const rows = Math.max(0, input.counts[i] || 0);
    if (grouped && starts[i] < bottom && starts[i] + LIST_HEADER > top) units.push({ group: i, kind: "heading", index: -1, top: starts[i] });
    if (shut) continue;
    const rowTop = starts[i] + (grouped ? LIST_HEADER : 0);
    const first = Math.max(0, Math.floor((top - rowTop) / LIST_ROW));
    const end = Math.min(rows, Math.max(0, Math.ceil((bottom - rowTop) / LIST_ROW)));
    for (let r = first; r < end; r++) units.push({ group: i, kind: "row", index: r, top: rowTop + r * LIST_ROW });
  }
  return { total, units };
}

export interface ListHost {
  ws: Workspace;
  group: Group;
  /** The base view element: Alt+Shift+Up/Down collapses headings, the same as table and cards. */
  el: HTMLElement;
  scroller: HTMLElement;
  /** K3's set for `<view name>\0<property>`, kept on the tab. */
  collapsed?: (scope: string) => Set<string>;
  groupMenu?: (event: MouseEvent, group: RowGroup) => void;
  repaint: () => void;
}

export function createList(host: ListHost) {
  const el = h("div", { class: "bases-list", role: "list", "aria-label": "Results" });
  el.hidden = true;
  host.scroller.append(el);
  let model: Model | null = null, entries: readonly Entry[] = [], automatic: RowGroup[] = [], groups: RowGroup[] = [], hiddenRows = 0;
  let collapsed = new Set<string>(), revision = 0, generation = 0, busy = false, gone = false, painted = "";
  let focusedGroup: string | undefined;
  const localCollapsed = new Map<string, Set<string>>();

  const keys = (event: KeyboardEvent) => {
    if (!event.altKey || !event.shiftKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown") || !model?.groupBy || busy) return;
    if ((event.target as Element).closest?.("input,textarea,[contenteditable]:not([contenteditable=\"false\"])")) return;
    event.preventDefault();
    if (event.key === "ArrowUp") for (const g of groups) collapsed.add(g.id); else collapsed.clear();
    revision++; painted = ""; host.repaint();
  };
  host.el.addEventListener("keydown", keys);

  function showNotices() {
    const notice = host.el.querySelector<HTMLElement>(":scope > .bases-notice");
    if (notice && model) { notice.textContent = [...model.notices].join(" · "); notice.hidden = !notice.textContent; }
  }

  function heading(g: RowGroup) {
    const id = g.id, shut = collapsed.has(id);
    const button = h("button", { type: "button", class: "bases-b5-toggle", "data-group-id": g.id, title: g.error?.message, "aria-expanded": String(!shut), "aria-label": `${g.label} (${g.rows.length})`,
      oncontextmenu: (event: MouseEvent) => { if (host.groupMenu) { event.preventDefault(); host.groupMenu(event, g); } } }, icon(shut ? "chevron-right" : "chevron-down", 14), h("span", null, g.label), h("span", { class: "bases-b5-count" }, String(g.rows.length)));
    return pressable(button, event => {
      event.stopPropagation(); shut ? collapsed.delete(id) : collapsed.add(id); revision++; painted = ""; host.repaint();
    });
  }

  function propertyText(entry: Entry, key: string): string {
    const value = entry.context.get(key);
    if (isFormulaError(value)) return "#ERROR!";
    if (value === null || value === "" || (Array.isArray(value) && !value.length)) return "";
    try { return displayValue(value); } catch { return "#ERROR!"; }
  }

  function row(entry: Entry, index: number, size: number, markers: Model["listMarkers"], separator: string): HTMLElement {
    const path = entry.row.file.path;
    const open = (e: MouseEvent) => { e.preventDefault(); void host.ws.open(path, { where: e.button === 1 ? "tab" : whereFromEvent(e), group: host.group }); };
    const item = h("div", { class: "bases-list-item", role: "listitem", "data-path": path, "data-index": String(index), "aria-posinset": String(index + 1), "aria-setsize": String(size) });
    if (markers === "numbers") item.append(h("span", { class: "bases-list-marker", "aria-hidden": "true" }, `${index + 1}.`));
    else if (markers === "bullets") item.append(h("span", { class: "bases-list-marker", "aria-hidden": "true" }, "•"));
    const link = h("a", { class: "internal-link bases-list-name", onclick: open, onauxclick: (e: MouseEvent) => { if (e.button === 1) open(e); } }, noteName(path));
    link.href = path;
    item.append(link);
    const props = h("span", { class: "bases-list-props" });
    let any = false;
    for (const key of model!.columns) {
      if (key === "file.name") continue;
      const text = propertyText(entry, key);
      if (!text) continue;
      any = true;
      props.append(h("span", { class: "bases-list-sep" }, separator), h("span", { class: "bases-list-prop", "data-property": key, "data-value": text, title: model!.label(key) }, text));
    }
    if (any) item.append(props);
    item.addEventListener("click", e => { if ((e.target as Element).closest("a,button")) return; open(e); });
    item.addEventListener("auxclick", e => { if (e.button !== 1 || (e.target as Element).closest("a,button")) return; open(e); });
    return item;
  }

  function draw(force = false): boolean {
    if (!model) return true;
    const active = document.activeElement;
    if (active instanceof HTMLElement && el.contains(active) && active.matches(".bases-b5-toggle")) focusedGroup = active.dataset.groupId;
    const grouped = !!model.groupBy;
    const counts = grouped ? groups.map(g => g.rows.length) : [entries.length];
    const shut = grouped ? groups.map(g => collapsed.has(g.id)) : [];
    // Read the viewport once, then only write. A scroll frame must not measure.
    const laid = listLayout({ counts, collapsed: shut, grouped, scrollTop: host.scroller.scrollTop, height: host.scroller.clientHeight });
    const key = `${generation}:${revision}:${laid.total}:${laid.units.map(u => `${u.kind}${u.group}:${u.index}`).join(",")}`;
    showNotices();
    if (!force && key === painted) return true;
    painted = key;
    el.dataset.markers = model.listMarkers;
    el.setAttribute("aria-rowcount", String(Math.max(0, entries.length - hiddenRows)));
    el.style.height = `${laid.total}px`;
    const fragment = document.createDocumentFragment();
    const pad = (height: number) => h("div", { class: "bases-list-pad", style: `height:${height}px`, "aria-hidden": "true" });
    const first = laid.units[0];
    if (first && first.top > 0) fragment.append(pad(first.top));
    for (const unit of laid.units) {
      if (unit.kind === "heading") { fragment.append(heading(groups[unit.group])); continue; }
      const source = grouped ? groups[unit.group].rows : entries;
      fragment.append(row(source[unit.index], unit.index, source.length, model.listMarkers, model.listSeparator));
    }
    const last = laid.units[laid.units.length - 1];
    const used = last ? last.top + (last.kind === "heading" ? LIST_HEADER : LIST_ROW) : 0;
    if (laid.total > used) fragment.append(pad(laid.total - used));
    el.replaceChildren(fragment);
    if (focusedGroup !== undefined) {
      [...el.querySelectorAll<HTMLButtonElement>(".bases-b5-toggle")].find(b => b.dataset.groupId === focusedGroup)?.focus({ preventScroll: true });
      focusedGroup = undefined;
    }
    return true;
  }

  function clear() {
    generation++; busy = false; model = null; entries = []; automatic = []; groups = []; hiddenRows = 0; painted = ""; focusedGroup = undefined;
    el.replaceChildren(); el.style.height = ""; el.hidden = true;
  }

  return {
    el,
    clear,
    async update(next: Model, rows: readonly Entry[], _types: Map<string, PropertyType>, obsolete: () => boolean = () => false): Promise<boolean> {
      const token = ++generation; busy = true;
      const cancelled = () => gone || token !== generation || obsolete();
      try {
        const grouped = next.groupBy ? await groupRowsAsync(rows, next.groupBy, { cancelled }) : [];
        if (cancelled()) { busy = false; return false; }
        const manual = next.groupBy ? parseManual(next.view.groupBy) : null;
        const all = next.groupBy ? arrangeGroups(grouped, manual) : [];
        const shown = manual ? all.filter(g => !g.hidden) : all;
        model = next; entries = rows; automatic = next.groupBy ? grouped : []; groups = shown;
        hiddenRows = all.length === shown.length ? 0 : all.reduce((sum, g) => sum + (g.hidden ? g.rows.length : 0), 0);
        const scope = `${next.name}\0${next.groupBy?.property}`;
        collapsed = host.collapsed?.(scope) ?? localCollapsed.get(scope) ?? new Set();
        if (!host.collapsed) localCollapsed.set(scope, collapsed);
        for (const message of manual?.notices ?? []) next.notices.add(message);
        painted = ""; busy = false; return true;
      } catch (e) {
        busy = false;
        if (e instanceof Error && e.name === "AbortError") return false;
        throw e;
      }
    },
    paint(current: Model, rows: readonly Entry[], force = false): boolean {
      if (!model || current !== model || rows !== entries) return true;
      return draw(force);
    },
    dispose() { gone = true; clear(); host.el.removeEventListener("keydown", keys); el.remove(); },
    rows: (): readonly Entry[] | null => model?.groupBy ? groups.flatMap(g => g.rows) : null,
    groups: (): readonly RowGroup[] => automatic,
    hiddenRows: () => hiddenRows,
  };
}
