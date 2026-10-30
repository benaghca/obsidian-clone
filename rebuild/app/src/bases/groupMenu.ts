// The toolbar's Group menu (KANBAN_PLAN §2.2): group by one property in A → Z,
// Z → A or Manual order. Manual lists every group with a grip to drag it, a
// tick to show or hide it, Show all / Hide all, Add group (an empty group: no
// note is made or changed) and ✕ on an added group nothing is in. Only the
// view's `groupBy` block is written (`order`, `hidden`); choosing A → Z or
// Z → A again drops both, which restores the automatic order and shows all.
// The rows are virtual (28 px each), so the menu opens on frame 1 with 1,000 groups.
import type { PropertyType } from "../editor/frontmatter";
import { h } from "../shell/dom";
import { icon, type IconName } from "../shell/icons";
import { closeMenu, showMenu, showMenuChild } from "../shell/menu";
import { drag, reordered } from "./drag";
import { isEmpty, type Value } from "./functions";
import { arrangeGroups, MANUAL_LIMIT, parseManual, valueKey, writeViewSetting, type Manual, type RowGroup } from "./groups";
import { baseModel, noteKey, propertyId } from "./model";
import { mapping, type Yaml } from "./yaml";

type Model = ReturnType<typeof baseModel>;
export interface GroupMenuHost {
  current(): Model;
  /** Every group of the last rebuild, in automatic order. */
  groups(): readonly RowGroup[];
  keys(): string[];
  kind(key: string): IconName;
  type(key: string): PropertyType;
  save(change: (source: string, base: Model) => string, done?: () => void): void;
}
const ROW = 28, SHOWN = 12, FILTER_AT = 30;

/** A group as an `order`/`hidden` entry: the YAML it was read from, else its value (a formula's link or date: its label). */
export function groupEntry(g: RowGroup, manual: Manual | null): Yaml {
  const read = manual?.entries.get(g.id);
  if (read !== undefined) return read;
  const v = g.value;
  if (g.id === "empty" || isEmpty(v)) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v) && v.every(item => typeof item === "string")) return v as string[];
  return g.label;
}

/** `groupBy` with Manual's `order` and `hidden` replaced, or both dropped (automatic). Its other keys stay. */
export function withManual(groupBy: Record<string, Yaml>, order?: Yaml[], hidden?: Yaml[]): Yaml {
  const rest = { ...groupBy };
  delete rest.order; delete rest.hidden;
  return order ? { ...rest, order, ...(hidden?.length ? { hidden } : {}) } : rest;
}

/** Write Manual order from the file as it is now: `edit` gets every group in its current order (hidden ones flagged). */
function writeManual(host: GroupMenuHost, edit: (all: RowGroup[]) => { order: RowGroup[]; hidden: RowGroup[] }, done?: () => void) {
  host.save((source, base) => {
    if (!base.groupBy || noteKey(base.groupBy.property) !== noteKey(host.current().groupBy?.property ?? "")) return source;
    const manual = parseManual(base.view.groupBy), next = edit(arrangeGroups(host.groups(), manual));
    return writeViewSetting(source, "groupBy", withManual(mapping(base.view.groupBy), next.order.map(g => groupEntry(g, manual)), next.hidden.map(g => groupEntry(g, manual))), base.viewIndex);
  }, done);
}
const hiddenOf = (all: RowGroup[]) => all.filter(g => g.hidden);

/** A group heading's "Hide group": switches to Manual (keeping the order shown) if needed. */
export function hideGroup(host: GroupMenuHost, group: RowGroup) {
  writeManual(host, all => ({ order: all, hidden: [...hiddenOf(all), ...all.filter(g => g.id === group.id && !g.hidden)] }));
}

/** Text typed into Add group, read as the property's type: `3` is a number for a number property. */
function typed(text: string, type: PropertyType | undefined): Value {
  if (type === "checkbox" && /^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if ((type === "number" || type === undefined) && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return Number(text);
  if (type === "list" || type === "tags" || type === "aliases") return [text];
  return text;
}

export function groupMenu(at: HTMLElement, host: GroupMenuHost, refresh = false) {
  const content = h("div", { class: "bases-group-menu-content", onclick: (e: MouseEvent) => e.stopPropagation() });
  let filter = "", focus: string | null = null, focusAdd = false;
  const reopen = () => groupMenu(at, host, true);
  const redraw = () => { if (content.isConnected) draw(); };
  const button = (label: string, glyph: IconName | null, run: () => void, cls = "") => h("button", { type: "button", class: cls, onclick: (e: MouseEvent) => { e.stopPropagation(); run(); } }, glyph ? icon(glyph) : null, h("span", null, label));

  function draw() {
    const base = host.current(), by = base.groupBy, manual = by ? parseManual(base.view.groupBy) : null;
    const all = by ? arrangeGroups(host.groups(), manual) : [];
    const kind = by ? host.type(by.property) : "text";
    const order = (asc: boolean) => kind === "date" || kind === "datetime" ? asc ? "Old → new" : "New → old" : kind === "number" ? asc ? "0 → 1" : "1 → 0" : asc ? "A → Z" : "Z → A";
    // The whole groupBy changes: the menu opens again over the rebuilt view.
    const write = (change: (groupBy: Record<string, Yaml>) => Yaml | undefined) => host.save((source, b) => writeViewSetting(source, "groupBy", change(mapping(b.view.groupBy)), b.viewIndex), reopen);
    const property = button(by ? base.label(by.property) : "None", by ? host.kind(by.property) : "group", () => showMenuChild(host.keys().map(key => ({
      title: base.label(key), icon: host.kind(key), checked: !!by && noteKey(key) === noteKey(by.property),
      action: () => by && noteKey(key) === noteKey(by.property) ? reopen() : write(g => ({ property: propertyId(key), direction: g.direction === "DESC" ? "DESC" : "ASC" })),
    })), property, "bases-group-picker"), "bases-group-property");
    property.append(icon("chevrons-up-down"));
    const rows: HTMLElement[] = [h("div", { class: "bases-group-title" }, "Group by"), h("div", { class: "bases-group-by" }, property, ...by ? [(() => {
      const many = host.groups().length > MANUAL_LIMIT;
      const picker = button(manual ? "Manual" : order(by.direction === "ASC"), null, () => showMenuChild([
        { title: order(true), checked: !manual && by.direction === "ASC", action: () => write(g => withManual({ ...g, direction: "ASC" })) },
        { title: order(false), checked: !manual && by.direction === "DESC", action: () => write(g => withManual({ ...g, direction: "DESC" })) },
        { title: many ? `Manual order needs ${MANUAL_LIMIT.toLocaleString("en-US")} groups or fewer` : "Manual", checked: !!manual, disabled: many && !manual, action: () => manual ? reopen() : writeManual(host, groups => ({ order: groups, hidden: [] }), reopen) },
      ], picker, "bases-group-picker"), "bases-group-order");
      picker.append(icon("chevrons-up-down"));
      return picker;
    })(), button("", "trash-2", () => write(() => undefined), "bases-group-clear")] : [])];
    rows.at(-1)!.querySelector(".bases-group-clear")?.setAttribute("aria-label", "Stop grouping");
    if (manual) {
      const keep = content.querySelector<HTMLElement>(".bases-group-list")?.scrollTop ?? 0;
      const list = h("div", { class: "bases-group-list", role: "list", "aria-label": "Groups" }), inner = h("div", { class: "bases-group-rows" });
      list.append(inner);
      let visible: RowGroup[] = [], first = -1, end = -1;
      const row = (g: RowGroup, i: number) => {
        const check = h("input", { type: "checkbox", "aria-label": `Show ${g.label}` });
        check.checked = !g.hidden;
        const el = h("div", { class: `bases-group-row${g.hidden ? " is-hidden" : ""}`, role: "listitem", "data-group-id": g.id, style: `transform:translateY(${i * ROW}px)` });
        check.addEventListener("change", () => { el.classList.toggle("is-hidden", !check.checked); focus = g.id; writeManual(host, all => ({ order: all, hidden: all.filter(x => x.id === g.id ? !check.checked : x.hidden) }), redraw); });
        check.addEventListener("keydown", e => {
          if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          e.preventDefault(); focus = g.id;
          const step = e.key === "ArrowUp" ? -1 : 1;
          writeManual(host, all => { const from = all.findIndex(x => x.id === g.id), to = from + step; return { order: from < 0 || to < 0 || to >= all.length ? all : reordered(all, from, step > 0 ? to + 1 : to), hidden: hiddenOf(all) }; }, redraw);
        });
        const grip = h("span", { class: "bases-group-grip", "aria-hidden": "true" }, icon("grip-vertical", 16));
        grip.addEventListener("pointerdown", e => lift(e, g, el));
        const empty = g.added && !g.rows.length;
        el.append(grip, h("label", null, check, h("span", { class: "bases-group-label" }, g.label), empty ? h("em", null, "empty · added") : null),
          ...empty ? [button("", "x", () => writeManual(host, all => ({ order: all.filter(x => x.id !== g.id), hidden: hiddenOf(all).filter(x => x.id !== g.id) }), redraw), "bases-group-remove")] : [],
          h("span", { class: "bases-group-count" }, g.rows.length.toLocaleString("en-US")));
        el.querySelector(".bases-group-remove")?.setAttribute("aria-label", `Remove ${g.label}`);
        return el;
      };
      // Only the rows in view (and a few past it) exist.
      const paint = (force = false) => {
        const from = Math.max(0, Math.floor(list.scrollTop / ROW) - 4), to = Math.min(visible.length, from + SHOWN + 8);
        if (!force && from === first && to === end) return;
        first = from; end = to;
        inner.replaceChildren(...visible.slice(from, to).map((g, i) => row(g, from + i)));
      };
      const fill = () => {
        visible = filter ? all.filter(g => g.label.toLowerCase().includes(filter)) : all;
        inner.style.height = `${visible.length * ROW}px`;
        paint(true);
      };
      let frame = 0;
      list.addEventListener("scroll", () => { frame ||= requestAnimationFrame(() => { frame = 0; paint(); }); }, { passive: true });
      /** Drag a row by its grip: the lifted row and a drop line move by transform; the slot is arithmetic. */
      const lift = (e: PointerEvent, g: RowGroup, el: HTMLElement) => {
        if (e.button !== 0) return;
        const top = list.getBoundingClientRect().top, height = list.clientHeight, line = h("div", { class: "bases-group-drop" });
        let y = e.clientY, slot: number | null = null, moved = false, tick = 0;
        const step = () => {
          tick = 0;
          const edge = y < top + 20 ? -8 : y > top + height - 20 ? 8 : 0;
          if (edge) list.scrollTop += edge;
          slot = Math.max(0, Math.min(visible.length, Math.round((y - top + list.scrollTop) / ROW)));
          line.style.transform = `translateY(${slot * ROW - 1}px)`;
          el.style.transform = `translateY(${y - top + list.scrollTop - ROW / 2}px)`;
          if (edge) tick = requestAnimationFrame(step);
        };
        drag(e, event => {
          y = event.clientY;
          if (!moved && Math.abs(y - e.clientY) > 4) { moved = true; el.classList.add("is-lifted"); inner.append(line); }
          if (moved) tick ||= requestAnimationFrame(step);
        }, cancelled => {
          cancelAnimationFrame(tick); line.remove(); el.classList.remove("is-lifted");
          if (cancelled || !moved || slot === null) { paint(true); return; }
          const before = visible[slot] ?? null;
          focus = g.id;
          writeManual(host, all => {
            const from = all.findIndex(x => x.id === g.id), to = before ? all.findIndex(x => x.id === before.id) : all.length;
            return { order: from < 0 || to < 0 ? all : reordered(all, from, to), hidden: hiddenOf(all) };
          }, redraw);
        });
      };
      if (all.length > FILTER_AT) {
        const find = h("input", { type: "search", placeholder: "Filter groups...", "aria-label": "Filter groups", value: filter, spellcheck: "false" });
        find.addEventListener("input", () => { filter = find.value.trim().toLowerCase(); list.scrollTop = 0; fill(); });
        rows.push(h("div", { class: "bases-search bases-group-filter" }, icon("search", 14), find));
      }
      const add = h("input", { type: "text", class: "bases-group-add", placeholder: "Add group", "aria-label": "Add group", spellcheck: "false" });
      add.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const text = add.value.trim();
        if (!text) return;
        const value = typed(text, by ? (/^(file|formula)\./.test(by.property) ? undefined : host.type(by.property)) : undefined);
        let id = ""; try { id = valueKey(value); } catch { /* added as text below */ }
        add.value = ""; focusAdd = true;
        writeManual(host, groups => {
          const existing = groups.find(g => g.id === id);
          // An existing value is shown (and found), not added twice.
          if (existing) { focus = existing.id; return { order: groups, hidden: hiddenOf(groups).filter(g => g !== existing) }; }
          return { order: [...groups, { id, value, label: text, rows: [], added: true }], hidden: hiddenOf(groups) };
        }, redraw);
      });
      rows.push(list,
        h("div", { class: "bases-group-actions" },
          button("Show all", "eye", () => writeManual(host, groups => ({ order: groups, hidden: [] }), redraw)),
          button("Hide all", "eye-off", () => writeManual(host, groups => ({ order: groups, hidden: groups }), redraw))),
        h("label", { class: "bases-group-add-row" }, icon("plus", 16), add));
      content.replaceChildren(...rows);
      list.scrollTop = keep;
      fill();
      if (focus !== null) {
        const at = visible.findIndex(g => g.id === focus);
        if (at >= 0 && (at < first || at >= end)) { list.scrollTop = Math.max(0, at * ROW - ROW * 4); paint(true); }
        list.querySelector<HTMLInputElement>(`.bases-group-row[data-group-id="${CSS.escape(focus)}"] input`)?.focus({ preventScroll: true });
        focus = null;
      }
      if (focusAdd) { add.focus(); focusAdd = false; }
    } else content.replaceChildren(...rows);
    // Grown (Manual turned on, a group added): keep the menu on screen.
    const menu = content.closest<HTMLElement>(".menu");
    if (menu) { const r = menu.getBoundingClientRect(); if (r.bottom > innerHeight - 8) menu.style.top = `${Math.max(8, innerHeight - 8 - r.height)}px`; }
  }

  draw();
  if (refresh) closeMenu();
  showMenu([{ title: "Group", content }], at, { className: "bases-group-menu", align: "right" });
}
