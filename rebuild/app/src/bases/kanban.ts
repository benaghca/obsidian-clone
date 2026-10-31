// Kanban (KANBAN_PLAN §2.1, design A): the view's groups as columns of
// cards. Read-only here (K4); moving cards is K5. Every card in a view has the
// same height, so all placement is arithmetic: only the columns in view have
// DOM, and in each only the cards in view (and a few past them), recycled by
// path while scrolling. Nothing in the scroll paths measures layout; the
// board's size comes from a ResizeObserver.
import "../styles/bases-kanban.css";
import { asType, fits, type PropertyType } from "../editor/frontmatter";
import { api, type NoteProperties } from "../api";
import { editProperty } from "../editor/propertyEdit";
import { noteName } from "../paths";
import { formatDate } from "../settings/dateFormat";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { showMenu } from "../shell/menu";
import { propertyIndex } from "../shell/propertyIndex";
import { tagsInText } from "../shell/linksTags";
import { vaultTags } from "../shell/vaultTags";
import { whereFromEvent, type Group } from "../tabs";
import type { Workspace } from "../workspace";
import { resolveCoverPath } from "./cards";
import { reordered } from "./drag";
import { isEmpty, type Value } from "./functions";
import { groupEntry, hideGroup, withManual, writeManual, type GroupMenuHost } from "./groupMenu";
import { arrangeGroups, groupRowsAsync, parseManual, valueKey, writeViewSetting, MANUAL_LIMIT, type Entry, type RowGroup, type SliceOptions } from "./groups";
import { moveHistory, reverseEdit, type MoveOp } from "./history";
import type { EditResult } from "../editor/propertyEdit";
import { inspectDocument, installMoves, propertyMove, readOnlyReason, writeProperty } from "./move";
import { mapping } from "./yaml";
import { baseModel, noteKey } from "./model";
import { newRow, rowSeed, seedColumn } from "./newRow";
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
  scope: () => string;
  count: (value: number) => void;
  matches: (entry: Entry) => boolean;
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
  const tab = group.active;
  let pendingWrites = 0;
  const waitingWrites: (() => void)[] = [];
  const finishedWrite = () => { if (--pendingWrites === 0) waitingWrites.splice(0).forEach(resolve => resolve()); };
  let scrollX = 0, info = new Map<string, NoteProperties>(), checking = new Map<string, Promise<void>>(), reasons = new Map<string, string>();
  let entries = new Map<string, Entry>();
  const live = h("div", { class: "bases-move-live", role: "status", "aria-live": "polite" });
  const message = h("span"), undoButton = h("button", { type: "button", onclick: () => void historyReplay(true) }, "Undo");
  const notice = h("div", { class: "bases-move-notice", role: "status" }, message, undoButton);
  const lock = h("div", { class: "bases-move-lock" }, icon("lock"));
  notice.hidden = true; lock.hidden = true; el.prepend(lock, notice, live);
  const history = () => moveHistory(tab, host.scope());
  const announce = (text: string, undo = false) => { live.textContent = text; message.textContent = text; notice.hidden = false; undoButton.hidden = !undo; };
  const keyOf = () => noteKey(model?.groupBy?.property ?? "");
  function reason(entry: Entry) {
    return readOnlyReason(model?.groupBy?.property) || reasons.get(entry.row.file.path) || (info.has(entry.row.file.path) ? "" : "Checking whether this note can be edited");
  }
  function decorate(entry: Entry, card: HTMLElement) {
    const why = reason(entry); card.classList.toggle("is-movable", !why); card.title = why;
    card.setAttribute("aria-description", why || "Space to pick up; Alt+Left or Alt+Right to move one column");
  }
  function check(entry: Entry, card: HTMLElement) {
    const path = entry.row.file.path, key = keyOf();
    decorate(entry, card);
    if (readOnlyReason(model?.groupBy?.property) || info.has(path) || reasons.has(path) || checking.has(path)) return;
    const m = model;
    const pending = (async () => {
      try {
        const doc = ws.editors.doc(path);
        const result = doc ? inspectDocument(doc.toString(), key) : await api.setProperty(path, { key, expect: null, to: null }, true);
        if (model !== m || gone) return;
        if ("status" in result) {
          if (result.status === "refused") reasons.set(path, result.reason);
          else if (result.status === "conflict") {
            // A valid property absent from the old index (e.g. a BOM-loaded editor).
            if (result.current) { const r = await api.setProperty(path, { key, expect: result.current, to: { lines: result.current } }, true); if (model !== m || gone) return; if (r.status === "done" || r.status === "unchanged") info.set(path, r.props); else reasons.set(path, "Note changed; refresh before moving"); }
          } else info.set(path, result.props);
        } else info.set(path, result);
      } catch (e) { if (model === m) reasons.set(path, String(e)); }
      finally { checking.delete(path); if (model === m) { for (const c of mounted.values()) { const node = c.cards.get(path); if (node) decorate(entry, node); } } }
    })();
    checking.set(path, pending);
  }
  function editFor(entry: Entry, target: RowGroup) {
    const why = reason(entry); if (why) throw Error(why);
    const key = keyOf(), metadata = info.get(entry.row.file.path)!;
    return propertyMove(key, metadata, target.id === "empty" ? null : target.value, propertyIndex(ws).host.typeOf(key) ?? undefined);
  }
  function slot(entry: Entry, ci: number) {
    const rows = columns[ci]?.rows ?? [];
    const target = columns[ci];
    if (target && info.has(entry.row.file.path)) {
      try {
        const edit = editFor(entry, target), result = editProperty(`---\n${info.get(entry.row.file.path)!.lines.join("\n")}\n---\n`, edit);
        if (result.status === "done" || result.status === "unchanged") { const row = { ...entry.row, props: result.props.props }; entry = { row, context: model!.context(row) }; }
      } catch { return 0; }
    }
    let lo = 0, hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const first = model!.select([entry.row, rows[mid].row], true)[0];
      if (first?.row.file.path === entry.row.file.path) hi = mid; else lo = mid + 1;
    }
    return lo;
  }
  async function tagFacts(entry: Entry, key: string) {
    if (!/^(tags|tag)$/i.test(key)) return;
    vaultTags(ws).forget();
    const path = entry.row.file.path, doc = ws.editors.doc(path);
    // The body may still contain a tag removed from frontmatter. Never subtract
    // frontmatter tags from the combined set: ask the fresh index (or live editor).
    const tags = doc ? tagsInText(doc.toString()) : (await api.tags([path]))[path] ?? [];
    entry.row = { ...entry.row, tags };
  }
  /** Mutate one entry, splice only its source/target arrays and repaint those windows. */
  function patch(entry: Entry, metadata: NoteProperties) {
    if (!model) return;
    const source = columns.find(g => g.rows.includes(entry));
    if (source) source.rows.splice(source.rows.indexOf(entry), 1);
    entry.row = { ...entry.row, props: metadata.props };
    entry.context = model.context(entry.row);
    info.set(entry.row.file.path, metadata);
    const selected = model.select([entry.row], true).length > 0 && host.matches(entry);
    const value = entry.context.get(model.groupBy!.property);
    let target: RowGroup | undefined;
    if (selected) { const id = valueKey(value); target = columns.find(g => g.id === id); if (target) target.rows.splice(slot(entry, columns.indexOf(target)), 0, entry); }
    for (const g of new Set([source, target])) {
      if (!g) continue;
      const c = mounted.get(g.id); if (!c) continue;
      const node = c.cards.get(entry.row.file.path); if (node) { release(node); node.remove(); c.cards.delete(entry.row.file.path); }
      c.el.querySelector(".bases-kanban-count")!.textContent = g.rows.length.toLocaleString("en-US");
      c.el.setAttribute("aria-label", `${labelOf(g)}, ${g.rows.length} notes`);
      c.inner.style.height = `${g.rows.length ? g.rows.length * pitch - KANBAN.cardGap : 0}px`;
      if (!g.rows.length) c.body.replaceChildren(h("div", { class: "bases-kanban-empty" }, `Drop here to set ${keyOf()} to ${labelOf(g)}`));
      else if (c.inner.parentNode !== c.body) c.body.replaceChildren(c.inner);
      fill(c, true);
    }
    host.count(columns.reduce((sum, g) => sum + g.rows.length, 0)); roving();
    if (target) focusCard(columns.indexOf(target), target.rows.indexOf(entry));
    return { selected: !!target };
  }
  async function historyReplay(back: boolean) {
    const m = model, hist = history();
    let previewed = false;
    const restore = new Map<string, { entry: Entry; info: NoteProperties; tags: string[] }>();
    const preview = (prepared: { op: MoveOp; result: EditResult }[]) => {
        if (model !== m) return;
        if (!previewed) { pendingWrites++; previewed = true; }
        for (const { op, result } of prepared) {
          if (result.status !== "done" && result.status !== "unchanged") continue;
          const entry = entries.get(op.path) ?? (op.row && { row: op.row, context: m!.context(op.row) });
          if (!entry) continue;
          let prior = info.get(op.path);
          if (!prior) {
            const restored = editProperty(`---\n${result.props.lines.join("\n")}\n---\n`, { key: op.key, expect: result.after, to: result.before === null ? null : { lines: result.before } });
            if (restored.status === "done" || restored.status === "unchanged") prior = restored.props;
          }
          if (prior && !restore.has(op.path)) restore.set(op.path, { entry, info: prior, tags: entry.row.tags });
          if (/^(tags|tag)$/i.test(op.key)) entry.row = { ...entry.row, tags: (back ? op.tagsBefore : op.row?.tags) ?? entry.row.tags };
          entries.set(op.path, entry);
          patch(entry, result.props);
        }
    };
    try {
      // Optimism is synchronous; fresh I/O preflight still gates every actual write.
      // A busy queue is previewed when its operation reaches the front instead.
      const head = hist.idle ? hist.peek(back) : undefined;
      if (head && !head.order) {
        const local = (back ? [...head.ops].reverse() : head.ops).map(op => {
          const doc = ws.editors.doc(op.path), metadata = info.get(op.path);
          const result = doc || metadata ? editProperty(doc?.toString() ?? `---\n${metadata!.lines.join("\n")}\n---\n`, reverseEdit(op, back)) : null;
          return result && { op, result };
        });
        if (local.every((p): p is NonNullable<typeof p> => !!p && (p.result.status === "done" || p.result.status === "unchanged"))) preview(local);
      }
      const record = await hist.replay(back, async (path, edit, dry) => {
        const result = await writeProperty(ws, path, edit, dry);
        if (!dry && model === m && (result.status === "done" || result.status === "unchanged")) { const entry = entries.get(path); if (entry) { await tagFacts(entry, edit.key).catch(() => {}); patch(entry, result.props); } }
        return result;
      }, preview, async (record, undo) => {
        const order = record.order!; let done = false;
        await host.groupHost().save((source) => {
          const original = baseModel(source, order.index);
          if (original.name !== order.view || JSON.stringify(original.view.groupBy) !== JSON.stringify(undo ? order.after : order.before)) throw Error("Group order changed since");
          return writeViewSetting(source, "groupBy", undo ? order.before : order.after, original.viewIndex);
        }, () => { done = true; });
        if (!done) throw Error("Group order changed since or could not be saved");
      });
      if (record) announce(`${back ? "Undid" : "Redid"} ${record.label}`, !back);
    } catch (e) { if (model === m) for (const prior of [...restore.values()].reverse()) { prior.entry.row = { ...prior.entry.row, tags: prior.tags }; patch(prior.entry, prior.info); } announce(`Can't ${back ? "undo" : "redo"}: ${e instanceof Error ? e.message : String(e)}`); } finally { if (previewed) finishedWrite(); }
  }
  function move(entry: Entry, ci: number) {
    const target = columns[ci], m = model; if (!target || !m || target.rows.includes(entry)) return;
    try {
      const edit = editFor(entry, target), path = entry.row.file.path, prior = info.get(path)!;
      const prospective = editProperty(`---\n${prior.lines.join("\n")}\n---\n`, edit);
      if (prospective.status !== "done" && prospective.status !== "unchanged") throw Error("This value doesn't fit the property");
      const hist = history(), label = `Moved "${noteName(path)}" to ${labelOf(target)}`;
      let tagsBefore = entry.row.tags;
      const patched = patch(entry, prospective.props);
      announce(`${label}${patched?.selected ? "" : " · it no longer matches this view's filters"}`);
      void hist.queue(async () => {
        pendingWrites++;
        try {
          if (/^(tags|tag)$/i.test(edit.key)) { await tagFacts(entry, edit.key).catch(() => {}); tagsBefore = entry.row.tags; }
          const result = await writeProperty(ws, path, edit);
          if (result.status === "conflict" || result.status === "refused") {
            if (model === m) patch(entry, prior);
            if (result.status === "conflict") ws.vault.written(path);
            throw Error(result.status === "conflict" ? `${noteName(path)} changed since the board was drawn (${edit.key} is now ${result.current ?? "No value"}). Not moved.` : result.reason);
          }
          if (/^(tags|tag)$/i.test(edit.key)) { await tagFacts(entry, edit.key).catch(() => {}); if (model === m) { const current = patch(entry, result.props); if (patched && current) patched.selected = current.selected; } }
          hist.push({ label, ops: [{ path, key: edit.key, before: result.before, after: result.after, row: entry.row, tagsBefore }] });
          if (!gone && model?.name === m.name) announce(`${label}${patched?.selected ? "" : " · it no longer matches this view's filters"}`, true);
        } catch (e) { if (!gone) { if (model === m) patch(entry, prior); announce(e instanceof Error ? e.message : String(e)); } } finally { finishedWrite(); }
      });
    } catch (e) { announce(e instanceof Error ? e.message : String(e)); }
  }
  const labelOf = (g: RowGroup) => g.id === "empty" ? "No value" : g.label;
  async function reorderColumns(from: number, to: number) {
    const m = model, item = columns[from], neighbour = columns[to];
    if (!m?.groupBy || !item || !neighbour || all.length > MANUAL_LIMIT) return;
    const hist = history(), groupHost = host.groupHost();
    try {
      await hist.queue(async () => {
        let before = m.view.groupBy, after = before, finished = false;
        await groupHost.save((source, base) => {
          if (base.name !== m.name || base.groupBy?.property !== m.groupBy?.property) throw Error("View changed; column not moved");
          before = base.view.groupBy;
          const manual = parseManual(before), list = arrangeGroups(groupHost.groups(), manual);
          const a = list.findIndex(g => g.id === item.id), b = list.findIndex(g => g.id === neighbour.id);
          if (a < 0 || b < 0) throw Error("Group changed; column not moved");
          after = withManual(mapping(before), reordered(list, a, to > from ? b + 1 : b).map(g => groupEntry(g, manual)), list.filter(g => g.hidden).map(g => groupEntry(g, manual)));
          return writeViewSetting(source, "groupBy", after, base.viewIndex);
        }, () => { finished = true; });
        if (!finished) throw Error("Column order could not be saved");
        hist.push({ label: "column order", ops: [], order: { view: m.name, index: m.viewIndex, before, after } });
        if (!gone) announce("Changed column order", true);
      });
    } catch (e) { if (!gone) announce(String(e)); }
  }
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
    check(entry, el);
    el.addEventListener("contextmenu", e => {
      e.preventDefault(); e.stopPropagation(); const why = reason(entry);
      showMenu([{ title: "Move to", disabled: !!why, submenu: () => columns.map(g => ({ title: labelOf(g), disabled: g.rows.includes(entry), action: () => move(entry, columns.indexOf(g)) })) }, ...(why ? [{ title: why, label: true }] : [])], { x: e.clientX, y: e.clientY });
    });
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
    let seed = rowSeed(m.columns, [m.root.filters, m.view.filters], types);
    try {
      if (by && !readOnlyReason(by.property)) {
        const key = noteKey(by.property);
        seed = seedColumn(seed, key, g.id === "empty" ? null : v, propertyIndex(ws).host.typeOf(key) ?? types.get(key));
      }
      void newRow(ws, seed).catch(host.error);
    } catch (e) { host.error(e); }
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
    const body = h("div", { class: "bases-kanban-body" }, count ? inner : h("div", { class: "bases-kanban-empty" }, readOnlyReason(model?.groupBy?.property) ? "No notes" : `Drop here to set ${keyOf()} to ${label(g)}`));
    const el = h("section", { class: "bases-kanban-col", role: "list", "aria-label": `${label(g)}, ${count} ${count === 1 ? "note" : "notes"}`, "data-group-id": g.id, style: `left:${KANBAN.pad + i * (width + KANBAN.gap)}px;width:${width}px` }, head, body);
    const c: Column = { g, el, body, inner, cards: new Map(), first: -1, end: -1 };
    let tick = 0;
    body.addEventListener("scroll", () => { scrollTops.set(g.id, body.scrollTop); tick ||= requestAnimationFrame(() => { tick = 0; if (!gone && model && mounted.get(g.id) === c) fill(c); }); }, { passive: true });
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
  const positionNotice = () => { notice.style.transform = `translateX(${scrollX}px)`; };
  el.addEventListener("scroll", () => { scrollX = el.scrollLeft; positionNotice(); frame ||= requestAnimationFrame(() => { frame = 0; paintBoard(); }); }, { passive: true });
  const moves = installMoves({ el, property: keyOf, columns: () => columns, reason, slot, move,
    geometry: () => ({ width, pitch, cardHeight, viewport: viewWidth, height: viewHeight, scrollX }),
    scrollX(value) { const next = Math.max(0, Math.min(Math.max(0, trackWidth(columns.length, width) - viewWidth), value)); if (next !== scrollX) { scrollX = next; el.scrollLeft = next; positionNotice(); } },
    scrollY(ci, value) { const g = columns[ci]; if (!g) return 0; const top = scrollTops.get(g.id) ?? 0; if (value === undefined) return top; const next = Math.max(0, Math.min(Math.max(0, g.rows.length * pitch - bodyHeight()), value)); if (next !== top) { scrollTops.set(g.id, next); const c = mounted.get(g.id); if (c) c.body.scrollTop = next; } return next; },
    entry: path => entries.get(path),
    reorder: (a, b) => void reorderColumns(a, b), announce, undo: back => void historyReplay(back),
  });
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
    moves.cancel();
    generation++;
    for (const id of [...mounted.keys()]) unmount(id);
    model = null; automatic = []; all = []; columns = []; hiddenRows = 0; columnsOf = null;
    track.style.width = "0px";
  }
  return {
    el,
    clear,
    idle: () => Promise.all([moves.idle(), pendingWrites ? new Promise<void>(resolve => waitingWrites.push(resolve)) : Promise.resolve()]).then(() => {}),
    /**
     * Group `rows` (the drawn, searched rows) into the board's columns. `selected` (the rows before
     * Search) decides which columns exist, so a search empties columns instead of removing them.
     */
    async update(next: Model, rows: readonly Entry[], propertyTypes: Map<string, PropertyType>, obsolete: () => boolean, selected: readonly Entry[] = rows, metadata: Map<string, NoteProperties> = info): Promise<boolean> {
      if (pendingWrites) return false;
      const token = ++generation, options: SliceOptions = { cancelled: () => gone || pendingWrites > 0 || token !== generation || obsolete() };
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
        moves.cancel();
        model = next; info = metadata; checking = new Map(); reasons = new Map();
        entries = new Map(selected.map(entry => [entry.row.file.path, entry]));
        const readOnly = readOnlyReason(by?.property);
        lock.hidden = !readOnly; lock.replaceChildren(icon("lock"), readOnly);
        for (const row of rows) { const path = row.row.file.path; if (row.row.file.size > 16 * 1024 * 1024) reasons.set(path, "Note exceeds 16 MB"); else if (row.row.props.some(p => p.key.toLowerCase() === keyOf().toLowerCase() && p.type === "unknown")) reasons.set(path, "Property is not safely editable"); }
        types = propertyTypes; automatic = groups; all = arranged; columns = shown;
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
    dispose() { gone = true; moves.dispose(); clear(); resize.disconnect(); cancelAnimationFrame(frame); el.remove(); },
  };
}
