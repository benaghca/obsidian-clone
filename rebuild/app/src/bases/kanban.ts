// Kanban (KANBAN_PLAN §2.1, design A): the view's groups as columns of
// cards. Read-only here (K4); moving cards is K5. Every card in a view has the
// same height, so all placement is arithmetic: only the columns in view have
// DOM, and in each only the cards in view (and a few past them), recycled by
// path while scrolling. Nothing in the scroll paths measures layout; the
// board's size comes from a ResizeObserver.
import "../styles/bases-kanban.css";
import { asType, fits, type PropertyType } from "../editor/frontmatter";
import { noteName } from "../paths";
import { formatDate } from "../settings/dateFormat";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { showMenu } from "../shell/menu";
import { propertyIndex } from "../shell/propertyIndex";
import { whereFromEvent, type Group } from "../tabs";
import type { Workspace } from "../workspace";
import { resolveCoverPath } from "./cards";
import { reordered } from "./drag";
import { isEmpty, type Value } from "./functions";
import { hideGroup, writeManual, type GroupMenuHost } from "./groupMenu";
import { arrangeGroups, groupRowsAsync, parseManual, type Entry, type RowGroup, type SliceOptions } from "./groups";
import { baseModel, noteKey } from "./model";
import { newRow, rowSeed } from "./newRow";
import { cardSpan, columnSpan, KANBAN, kanbanCardHeight, nearestIndex, trackWidth } from "./kanbanLayout";

type Model = ReturnType<typeof baseModel>;

export interface KanbanHost {
  ws: Workspace;
  group: Group;
  /** The Group menu's writer (menus.ts): Hide and Move write Manual order through it. */
  groupHost: () => GroupMenuHost;
  /** Open the toolbar's Group menu (the no-groupBy prompt). */
  openGroupMenu: () => void;
  error: (e: unknown) => void;
}

interface Column { g: RowGroup; el: HTMLElement; body: HTMLElement; inner: HTMLElement; cards: Map<string, HTMLElement>; first: number; end: number }
interface Cover { held: ReturnType<Workspace["embeds"]["image"]>; unwatch: () => void }

export function createKanban(host: KanbanHost) {
  const { ws, group } = host;
  const el = h("div", { class: "bases-kanban", role: "group", "aria-label": "Board", tabindex: "-1" });
  const prompt = h("div", { class: "bases-kanban-prompt" }, h("span", null, "Group by a property to make columns."), h("button", { type: "button", onclick: () => host.openGroupMenu() }, icon("group"), "Group by…"));
  const track = h("div", { class: "bases-kanban-track" });
  el.append(prompt, track);
  el.hidden = true;
  let model: Model | null = null, types = new Map<string, PropertyType>();
  // `automatic`: every group in automatic order (the Group menu); `columns`: those shown, in order.
  let automatic: RowGroup[] = [], all: RowGroup[] = [], columns: RowGroup[] = [], hiddenRows = 0, generation = 0, gone = false;
  let width: number = KANBAN.width, cardHeight = 0, pitch = 0, viewWidth = 0, viewHeight = 0, props: string[] = [], coverHeight = 0;
  const mounted = new Map<string, Column>(), scrollTops = new Map<string, number>(), covers = new Map<HTMLElement, Cover>();
  let focusPath: string | null = null, frame = 0;
  // The columns' grouping of the rows before Search: kept while typing a query, when only the cards change.
  let columnsOf: { model: Model; rows: readonly Entry[]; groups: RowGroup[] } | null = null;
  // The track's height less the column's top and bottom space, border and header.
  const bodyHeight = () => Math.max(0, viewHeight - KANBAN.pad * 2 - 2 - KANBAN.head);
  const label = (g: RowGroup) => g.id === "empty" ? "No value" : g.label;

  function release(card: HTMLElement) {
    const cover = covers.get(card);
    if (!cover) return;
    covers.delete(card); cover.unwatch(); cover.held.release();
  }
  function cover(card: HTMLElement, path: string, fit: string) {
    const box = card.querySelector<HTMLElement>(".bases-kanban-cover")!;
    const show = (held: Cover["held"]) => void held.url.then(url => {
      if (covers.get(card)?.held !== held) return;
      const img = box.querySelector("img") ?? box.appendChild(h("img", { alt: "" }));
      img.decoding = "async";
      img.style.objectFit = fit; img.src = url;
    }, () => {});
    const held = ws.embeds.image(path);
    const unwatch = ws.embeds.watch(path, () => { const c = covers.get(card); if (!c) return; c.held.release(); show(c.held = ws.embeds.image(path)); });
    covers.set(card, { held, unwatch }); show(held);
  }
  function value(key: string, entry: Entry): HTMLElement {
    let v: Value = entry.context.get(key);
    const p = entry.row.props.find(q => q.key === noteKey(key)), want = propertyIndex(ws).host.typeOf(noteKey(key));
    if (p && want && fits(p, want)) v = asType(p, want);
    const kind = key === "file.mtime" || key === "file.ctime" ? "datetime" : types.get(noteKey(key)) ?? (typeof v === "boolean" ? "checkbox" : "text");
    const box = h("span", { class: "bases-kanban-value", "data-property": key });
    if (v === null || v === "" || isEmpty(v)) return box;
    if (typeof v === "boolean") { const check = h("input", { type: "checkbox", "aria-label": model!.label(key) }); check.checked = v; check.disabled = true; box.append(check); }
    else if (Array.isArray(v)) for (const item of v) { if (item !== null && item !== "") box.append(h("span", { class: "property-pill is-tag" }, String(item))); }
    else box.textContent = (kind === "date" || kind === "datetime") && /Z$/.test(String(v)) ? formatDate(new Date(String(v)), "YYYY-MM-DDTHH:mm:ss") : String(v);
    return box;
  }
  function card(entry: Entry, index: number, count: number): HTMLElement {
    const path = entry.row.file.path;
    const open = (e: MouseEvent) => { if ((e.target as Element).closest("input,button,a")) return; e.preventDefault(); void ws.open(path, { where: e.button === 1 ? "tab" : whereFromEvent(e), group }); };
    const el = h("div", { class: "bases-kanban-card", role: "listitem", tabindex: "-1", "data-path": path, "aria-posinset": String(index + 1), "aria-setsize": String(count), onclick: open, onauxclick: (e: MouseEvent) => { if (e.button === 1) open(e); } });
    if (model!.image) {
      el.append(h("div", { class: "bases-kanban-cover" }));
      const resolved = resolveCoverPath(ws, entry.context.get(model!.image), path);
      if (resolved) cover(el, resolved, model!.imageFit);
    }
    el.append(h("div", { class: "bases-kanban-title" }, noteName(path)));
    for (const key of props) el.append(h("div", { class: "bases-kanban-prop" }, h("span", { class: "bases-kanban-key" }, model!.label(key)), value(key, entry)));
    return el;
  }
  /** Draw a column's cards for its scroll position; cards already drawn are kept and moved. */
  function fill(c: Column, force = false) {
    const rows = c.g.rows, { first, end } = cardSpan(rows.length, c.body.scrollTop, bodyHeight(), pitch);
    if (!force && first === c.first && end === c.end) return;
    c.first = first; c.end = end;
    const keep = new Set<string>(), fragment = document.createDocumentFragment();
    for (let i = first; i < end; i++) {
      const path = rows[i].row.file.path;
      keep.add(path);
      let el = c.cards.get(path);
      if (!el) { el = card(rows[i], i, rows.length); c.cards.set(path, el); fragment.append(el); }
      if (el.dataset.index !== String(i)) { el.dataset.index = String(i); el.style.transform = `translateY(${i * pitch}px)`; el.setAttribute("aria-posinset", String(i + 1)); }
    }
    for (const [path, el] of c.cards) if (!keep.has(path)) { release(el); el.remove(); c.cards.delete(path); }
    c.inner.append(fragment);
  }
  function columnMenu(at: HTMLElement | MouseEvent, g: RowGroup) {
    const index = columns.indexOf(g);
    const move = (step: -1 | 1) => writeManual(host.groupHost(), list => {
      const from = list.findIndex(x => x.id === g.id), neighbour = columns[index + step];
      const to = neighbour ? list.findIndex(x => x.id === neighbour.id) : -1;
      return { order: from < 0 || to < 0 ? list : reordered(list, from, step > 0 ? to + 1 : to), hidden: list.filter(x => x.hidden) };
    });
    showMenu([
      { title: "Hide group", icon: "eye-off", disabled: !model?.groupBy, action: () => hideGroup(host.groupHost(), g) },
      { title: "Move left", icon: "arrow-left", disabled: !model?.groupBy || index <= 0, action: () => move(-1) },
      { title: "Move right", icon: "arrow-right", disabled: !model?.groupBy || index < 0 || index >= columns.length - 1, action: () => move(1) },
    ], at instanceof MouseEvent ? { x: at.clientX, y: at.clientY } : at);
  }
  /** A new note in this column: the view's New row, with the column's value as one more seed. */
  function create(g: RowGroup) {
    const m = model!, by = m.groupBy, v = g.value;
    const seed = by && !g.id.startsWith("ls:") && (typeof v === "string" || typeof v === "number" || typeof v === "boolean") ? `${by.property} == ${JSON.stringify(v)}` : undefined;
    void newRow(ws, rowSeed(m.columns, [m.root.filters, m.view.filters, seed], types)).catch(host.error);
  }
  function mount(g: RowGroup, i: number): Column {
    const count = g.rows.length;
    const more = h("button", { type: "button", class: "bases-kanban-more", "aria-label": `${label(g)} options` }, icon("ellipsis"));
    more.addEventListener("click", e => { e.stopPropagation(); columnMenu(more, g); });
    const add = h("button", { type: "button", class: "bases-kanban-add", "aria-label": `New note in ${label(g)}` }, icon("plus"));
    add.addEventListener("click", e => { e.stopPropagation(); create(g); });
    const head = h("div", { class: "bases-kanban-head", oncontextmenu: (e: MouseEvent) => { e.preventDefault(); columnMenu(e, g); } },
      h("span", { class: "bases-kanban-label", title: label(g) }, label(g)), h("span", { class: "bases-kanban-count" }, count.toLocaleString("en-US")), add, more);
    const inner = h("div", { class: "bases-kanban-cards", style: `height:${count ? count * pitch - KANBAN.cardGap : 0}px` });
    const body = h("div", { class: "bases-kanban-body" }, count ? inner : h("div", { class: "bases-kanban-empty" }, "No notes"));
    const el = h("section", { class: "bases-kanban-col", role: "list", "aria-label": `${label(g)}, ${count} ${count === 1 ? "note" : "notes"}`, "data-group-id": g.id, style: `left:${KANBAN.pad + i * (width + KANBAN.gap)}px;width:${width}px` }, head, body);
    const c: Column = { g, el, body, inner, cards: new Map(), first: -1, end: -1 };
    let tick = 0;
    body.addEventListener("scroll", () => { scrollTops.set(g.id, body.scrollTop); tick ||= requestAnimationFrame(() => { tick = 0; fill(c); }); }, { passive: true });
    return c;
  }
  function unmount(id: string) {
    const c = mounted.get(id)!;
    for (const card of c.cards.values()) release(card);
    c.el.remove(); mounted.delete(id);
  }
  /** Mount the columns in view (and one each side), drop the rest, and fill each. */
  function paintBoard(force = false) {
    if (!model || gone) return;
    const { first, end } = columnSpan(columns.length, el.scrollLeft, viewWidth, width);
    const want = new Set(columns.slice(first, end).map(g => g.id));
    for (const id of [...mounted.keys()]) if (!want.has(id)) unmount(id);
    const added: Column[] = [];
    for (let i = first; i < end; i++) {
      const g = columns[i];
      if (mounted.has(g.id)) { if (force) fill(mounted.get(g.id)!, true); continue; }
      const c = mount(g, i); mounted.set(g.id, c); track.append(c.el); added.push(c);
    }
    // Scroll offsets are restored once the columns are in the document, then their cards drawn.
    for (const c of added) { const top = scrollTops.get(c.g.id); if (top) c.body.scrollTop = top; }
    for (const c of added) fill(c, true);
    roving();
  }
  /** Only the focused card (or, when it isn't drawn, the board) is in the tab order. */
  function roving() {
    let drawn = false;
    for (const c of mounted.values()) for (const [path, card] of c.cards) { const on = path === focusPath; card.tabIndex = on ? 0 : -1; drawn ||= on; }
    el.tabIndex = drawn ? -1 : 0;
  }
  el.addEventListener("scroll", () => { frame ||= requestAnimationFrame(() => { frame = 0; paintBoard(); }); }, { passive: true });
  // The board's width and the track's height (the ungrouped prompt sits above the track).
  const resize = new ResizeObserver(entries => {
    let changed = false;
    for (const { target, contentRect } of entries) {
      if (target === el && contentRect.width !== viewWidth) { viewWidth = contentRect.width; changed = true; }
      if (target === track && contentRect.height !== viewHeight) { viewHeight = contentRect.height; changed = true; }
    }
    if (changed) paintBoard(true);
  });
  resize.observe(el); resize.observe(track);

  // Keyboard (§2.1): one card is in the tab order; arrows move between cards and columns, Enter opens.
  function focusCard(ci: number, index: number) {
    const g = columns[ci];
    if (!g || !g.rows.length) return;
    index = Math.max(0, Math.min(g.rows.length - 1, index));
    const left = KANBAN.pad + ci * (width + KANBAN.gap);
    if (left < el.scrollLeft) el.scrollLeft = left - KANBAN.pad;
    else if (left + width > el.scrollLeft + viewWidth) el.scrollLeft = left + width + KANBAN.pad - viewWidth;
    paintBoard();
    const c = mounted.get(g.id);
    if (!c) return;
    const top = index * pitch, view = bodyHeight();
    if (top < c.body.scrollTop) c.body.scrollTop = top;
    else if (top + cardHeight > c.body.scrollTop + view) c.body.scrollTop = top + cardHeight - view;
    scrollTops.set(g.id, c.body.scrollTop);
    focusPath = g.rows[index].row.file.path;
    for (const other of mounted.values()) fill(other, other === c);
    roving();
    c.cards.get(focusPath)?.focus({ preventScroll: true });
  }
  el.addEventListener("keydown", e => {
    const target = (e.target as Element).closest<HTMLElement>(".bases-kanban-card");
    if (!target || e.altKey) return;
    const ci = columns.findIndex(g => g.id === target.closest<HTMLElement>(".bases-kanban-col")?.dataset.groupId), index = Number(target.dataset.index);
    if (ci < 0) return;
    const c = mounted.get(columns[ci].id)!;
    const step = (to: number, i: number) => { e.preventDefault(); focusCard(to, i); };
    switch (e.key) {
      case "ArrowDown": return step(ci, index + 1);
      case "ArrowUp": return step(ci, index - 1);
      case "Home": return step(ci, 0);
      case "End": return step(ci, columns[ci].rows.length - 1);
      case "PageDown": return step(ci, index + Math.max(1, Math.floor(bodyHeight() / pitch)));
      case "PageUp": return step(ci, index - Math.max(1, Math.floor(bodyHeight() / pitch)));
      case "ArrowLeft": case "ArrowRight": {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        let to = ci + dir;
        while (columns[to] && !columns[to].rows.length) to += dir;
        if (!columns[to]) { e.preventDefault(); return; }
        return step(to, nearestIndex(index, c.body.scrollTop, scrollTops.get(columns[to].id) ?? 0, columns[to].rows.length, pitch));
      }
      case "Enter": e.preventDefault(); void ws.open(target.dataset.path!, { where: e.ctrlKey || e.metaKey ? "tab" : false, group }); return;
    }
  });
  // Tabbing to the board (its focused card scrolled away) brings that card back into view.
  el.addEventListener("focusin", e => {
    const card = (e.target as Element).closest<HTMLElement>(".bases-kanban-card");
    if (card) { if (focusPath !== card.dataset.path) { focusPath = card.dataset.path!; roving(); } return; }
    if (e.target !== el) return;
    const ci = columns.findIndex(g => g.rows.some(r => r.row.file.path === focusPath));
    if (ci >= 0) focusCard(ci, columns[ci].rows.findIndex(r => r.row.file.path === focusPath));
  });

  function clear() {
    generation++;
    for (const id of [...mounted.keys()]) unmount(id);
    model = null; automatic = []; all = []; columns = []; hiddenRows = 0; columnsOf = null;
    track.style.width = "0px";
  }
  return {
    el,
    clear,
    /**
     * Group `rows` (the drawn, searched rows) into the board's columns. `selected` (the rows before
     * Search) decides which columns exist, so a search empties columns instead of removing them.
     */
    async update(next: Model, rows: readonly Entry[], propertyTypes: Map<string, PropertyType>, obsolete: () => boolean, selected: readonly Entry[] = rows): Promise<boolean> {
      const token = ++generation, options: SliceOptions = { cancelled: () => gone || token !== generation || obsolete() };
      try {
        const by = next.groupBy;
        const grouped = await groupRowsAsync(rows, by, options);
        const groups = selected === rows ? grouped : columnsOf?.model === next && columnsOf.rows === selected ? columnsOf.groups : await groupRowsAsync(selected, by, options);
        if (options.cancelled!()) return false;
        columnsOf = { model: next, rows: selected, groups };
        const manual = by ? parseManual(next.view.groupBy) : null, arranged = arrangeGroups(groups, manual);
        const byId = new Map(grouped.map(g => [g.id, g]));
        // Each column holds the searched rows of its group (none when Search left it empty).
        const withRows = (g: RowGroup): RowGroup => selected === rows ? g : { ...g, rows: byId.get(g.id)?.rows ?? [] };
        const shown = arranged.filter(g => !g.hidden).map(withRows);
        hiddenRows = arranged.reduce((sum, g) => sum + (g.hidden ? withRows(g).rows.length : 0), 0);
        for (const id of [...mounted.keys()]) unmount(id);
        model = next; types = propertyTypes; automatic = groups; all = arranged; columns = shown;
        if (!columns.some(g => g.rows.some(r => r.row.file.path === focusPath))) focusPath = columns.find(g => g.rows.length)?.rows[0].row.file.path ?? null;
        const view = next.view;
        width = typeof view.cardSize === "number" || typeof view.cardSize === "string" ? Math.max(200, next.cardSize) : KANBAN.width;
        props = next.columns.filter(key => noteKey(key) !== "file.name");
        coverHeight = next.image ? Math.round((width - KANBAN.side * 2) * next.imageAspectRatio) : 0;
        cardHeight = kanbanCardHeight(props.length, coverHeight); pitch = cardHeight + KANBAN.cardGap;
        el.style.setProperty("--bases-kanban-card-height", `${cardHeight}px`);
        el.style.setProperty("--bases-kanban-cover-height", `${coverHeight}px`);
        el.style.setProperty("--bases-kanban-head", `${KANBAN.head}px`);
        el.classList.toggle("is-ungrouped", !by);
        track.style.width = `${trackWidth(columns.length, width)}px`;
        return true;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return false;
        throw e;
      }
    },
    paint(current: Model, _rows: readonly Entry[], force = false): boolean {
      if (current !== model) return false;
      paintBoard(force);
      return true;
    },
    /** A new query: every column back to its top (B6: a new query scrolls to the top). */
    top() { scrollTops.clear(); for (const c of mounted.values()) c.body.scrollTop = 0; },
    /** Rows in the order the board draws them, for Copy and Export CSV. */
    rows: (): readonly Entry[] | null => model ? columns.flatMap(g => g.rows) : null,
    groups: (): readonly RowGroup[] => automatic,
    hiddenRows: () => hiddenRows,
    /** The arranged groups, hidden ones flagged (tests and the column menu). */
    arranged: (): readonly RowGroup[] => all,
    dispose() { gone = true; clear(); resize.disconnect(); cancelAnimationFrame(frame); el.remove(); },
  };
}
