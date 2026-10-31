// K5: one property per move. Open documents use the editor; closed notes use Rust CAS.
import type { NoteProperties } from "../api";
import { type PropertyType } from "../editor/frontmatter";
import { editProperty, type PropertyEdit, type EditResult } from "../editor/propertyEdit";
import { h } from "../shell/dom";
import type { Workspace } from "../workspace";
import { drag } from "./drag";
import { isEmpty, type Value } from "./functions";
import { KANBAN } from "./kanbanLayout";
import type { Entry, RowGroup } from "./groups";
import "../styles/bases-kanban-move.css";
export const readOnlyReason = (key: string | undefined) => !key ? "Choose a note property to move cards" : /^(formula|file|this)\./.test(key) ? `Grouped by ${key.startsWith("formula.") ? "a formula" : key.startsWith("file.") ? "a file fact" : "this note"}: cards can't be moved` : "";
export function propertyMove(key: string, info: NoteProperties, target: Value, chosen?: PropertyType): PropertyEdit {
  const p = info.props.find(p => p.key.toLowerCase() === key.toLowerCase());
  const type = chosen ?? (p?.type !== "unknown" ? p?.type : undefined) ?? (Array.isArray(target) ? "list" : typeof target === "number" ? "number" : typeof target === "boolean" ? "checkbox" : typeof target === "string" && /^\d{4}-\d{2}-\d{2}/.test(target) ? target.includes("T") ? "datetime" : "date" : "text");
  const empty = isEmpty(target), list = ["list", "tags", "aliases"].includes(type);
  const value = empty ? list ? [] : "" : list ? Array.isArray(target) ? target : [target] : type === "number" ? String(target) : target;
  if (p?.type === "unknown") throw Error("Property is not safely editable");
  if (!(typeof value === "string" || typeof value === "boolean" || Array.isArray(value) && value.every(v => typeof v === "string"))) throw Error("This value doesn't fit the property type");
  const edit: PropertyEdit = { key, expect: p ? info.lines.slice(p.line, p.line + p.count).join("\n") : null, to: { type, value } };
  // Validate the conversion and formatting against only the metadata, never a stale whole note.
  const result = editProperty(`---\n${info.lines.join("\n")}\n---\n`, edit);
  if (result.status === "refused") throw Error(result.reason);
  return edit;
}
export function inspectDocument(text: string, key: string): NoteProperties {
  let result = editProperty(text, { key, expect: null, to: null });
  if (result.status === "conflict") result = editProperty(text, { key, expect: result.current, to: result.current === null ? null : { lines: result.current } });
  if (result.status === "refused") throw Error(result.reason);
  if (result.status === "conflict") throw Error("Note changed during inspection");
  return result.props;
}
let nativeAPI: Promise<typeof import("../api")> | undefined;
export async function writeProperty(ws: Workspace, path: string, edit: PropertyEdit, dryRun = false): Promise<EditResult> {
  if (!ws.editors.isLoaded(path)) {
    const { api } = await (nativeAPI ??= import("../api"));
    if (ws.editors.isLoaded(path)) return writeProperty(ws, path, edit, dryRun);
    const result = await api.setProperty(path, edit, dryRun);
    if (!dryRun && (result.status === "done" || result.status === "unchanged")) ws.vault.written(path);
    return result;
  }
  const doc = ws.editors.doc(path);
  if (!doc) return { status: "refused", reason: "Editor is no longer loaded" };
  const result = editProperty(doc.toString(), edit);
  if (!dryRun && result.status === "done" && result.change) ws.editors.change(path, { changes: result.change, userEvent: "input.property", scrollIntoView: false });
  return result;
}

export interface MoveSurface {
  el: HTMLElement;
  property(): string;
  columns(): readonly RowGroup[];
  geometry(): { width: number; pitch: number; cardHeight: number; viewport: number; height: number; scrollX: number };
  scrollX(value: number): void;
  scrollY(column: number, value?: number): number;
  entry(path: string): Entry | undefined;
  reason(entry: Entry): string;
  slot(entry: Entry, column: number): number;
  move(entry: Entry, column: number): void;
  reorder(from: number, to: number): void;
  announce(text: string): void;
  undo(back: boolean): void;
}
/** Pointer geometry is sampled once after the threshold. Each frame uses only cached arithmetic. */
export function installMoves(board: MoveSurface) {
  const abort = new AbortController(), options = { signal: abort.signal };
  let cancel: (() => void) | undefined, suppressClick = false, tracking = false;
  const waiting: (() => void)[] = [];
  const settled = () => { if (!tracking && !picked) waiting.splice(0).forEach(resolve => resolve()); };
  let picked: { entry: Entry; column: number } | null = null;
  const cancelPicked = () => { if (picked) { picked = null; settled(); board.announce("Move cancelled"); } };
  const say = (column: number) => { const g = board.columns()[column]; if (g) board.announce(`Drop to set ${board.property()} to ${g.id === "empty" ? "No value" : g.label}. Space to drop, Escape to cancel.`); };
  board.el.addEventListener("click", e => { if (suppressClick) { e.preventDefault(); e.stopImmediatePropagation(); suppressClick = false; } }, { ...options, capture: true });
  board.el.addEventListener("pointerdown", e => {
    suppressClick = false;
    cancelPicked();
    if (e.button !== 0 || (e.target as Element).closest("button,input,a")) return;
    cancel?.();
    const card = (e.target as Element).closest<HTMLElement>(".bases-kanban-card"), head = (e.target as Element).closest<HTMLElement>(".bases-kanban-head");
    if (!card && !head) return;
    const entry = card ? board.entry(card.dataset.path!) : undefined;
    if (entry && board.reason(entry)) return;
    const from = board.columns().findIndex(g => g.id === (card ?? head)!.closest<HTMLElement>(".bases-kanban-col")?.dataset.groupId);
    if (from < 0 || !entry && board.columns().length > 1000) return;
    const startX = e.clientX, startY = e.clientY;
    let x = startX, y = startY, ghost: HTMLElement | null = null, line: HTMLElement | null = null, raf = 0, to = from, rect: DOMRect, origin: DOMRect, geo: ReturnType<MoveSurface["geometry"]>, lastColumn: HTMLElement | null = null;
    const source = card ?? head!, preparedGhost = source.cloneNode(true) as HTMLElement, slots = new Map<number, number>();
    if (entry) slots.set(from, Number(source.dataset.index));
    const render = () => {
      const columns = board.columns(), scroll = board.geometry().scrollX;
      to = Math.max(0, Math.min(columns.length - 1, Math.floor((x - rect.left + scroll - KANBAN.pad) / (geo.width + KANBAN.gap))));
      if (x < rect.left || x > rect.left + geo.viewport || y < rect.top || y > rect.bottom) to = -1;
      ghost!.style.transform = `translate3d(${x - startX}px,${y - startY}px,0)`;
      const col = to < 0 ? null : board.el.querySelector<HTMLElement>(`[data-group-id=${CSS.escape(columns[to].id)}]`);
      if (col !== lastColumn) { lastColumn?.classList.remove("is-drop-target"); col?.classList.add("is-drop-target"); lastColumn = col; if (to >= 0) { if (entry) say(to); else board.announce(`Drop to move this column to position ${to + 1}`); } }
      line!.hidden = to < 0;
      if (to >= 0) {
        const top = entry ? rect.top + KANBAN.pad + KANBAN.head + 1 + (slots.get(to) ?? (slots.set(to, board.slot(entry, to)), slots.get(to)!)) * geo.pitch - board.scrollY(to) : rect.top + KANBAN.pad;
        line!.style.transform = `translate3d(${rect.left + KANBAN.pad + to * (geo.width + KANBAN.gap) - scroll + (entry ? KANBAN.side : 0)}px,${entry ? Math.max(rect.top + KANBAN.pad + KANBAN.head, Math.min(rect.bottom - KANBAN.pad, top)) : rect.top + KANBAN.pad}px,0)`;
      }
    };
    const tick = () => {
      if (!ghost) return;
      const speed = (p: number, lo: number, hi: number) => p < lo + 48 ? -Math.min(16, (lo + 48 - p) / 3) : p > hi - 48 ? Math.min(16, (p - hi + 48) / 3) : 0;
      board.scrollX(board.geometry().scrollX + speed(x, rect.left, rect.left + geo.viewport));
      if (entry && to >= 0) board.scrollY(to, board.scrollY(to) + speed(y, rect.top + KANBAN.pad + KANBAN.head, rect.bottom - KANBAN.pad));
      render(); raf = requestAnimationFrame(tick);
    };
    tracking = true;
    cancel = drag(e, event => {
      x = event.clientX; y = event.clientY;
      if (!ghost && Math.hypot(x - startX, y - startY) >= 4) {
        geo = board.geometry(); const root = board.el.getBoundingClientRect(), top = board.el.querySelector(".bases-kanban-track")!.getBoundingClientRect().top; rect = new DOMRect(root.left, top, geo.viewport, geo.height); origin = source.getBoundingClientRect();
        ghost = preparedGhost; ghost.classList.add("bases-move-ghost"); ghost.removeAttribute("tabindex"); ghost.setAttribute("aria-hidden", "true");
        Object.assign(ghost.style, { left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px`, transform: "none" });
        ghost.style.setProperty("--bases-kanban-card-height", `${geo.cardHeight}px`);
        ghost.style.setProperty("--bases-kanban-cover-height", getComputedStyle(source).getPropertyValue("--bases-kanban-cover-height"));
        line = h("div", { class: "bases-move-line", style: `width:${entry ? geo.width - KANBAN.side * 2 : 3}px;height:${entry ? 3 : geo.height - KANBAN.pad * 2}px` });
        document.body.append(ghost, line); source.classList.add("is-moving"); tick();
      }
    }, (cancelled, event) => {
      cancel = undefined; tracking = false; cancelAnimationFrame(raf); settled();
      if (!ghost) return;
      if (event) { x = event.clientX; y = event.clientY; render(); }
      ghost.remove(); line?.remove(); source.classList.remove("is-moving"); lastColumn?.classList.remove("is-drop-target"); suppressClick = true;
      if (!cancelled && to >= 0 && to !== from) { if (entry) board.move(entry, to); else board.reorder(from, to); }
      else board.announce("Move cancelled");
    });
  }, options);
  board.el.addEventListener("keydown", e => {
    suppressClick = false;
    const target = e.target as Element;
    // The note editor is contenteditable around an embedded board. A card there is still the board's key target.
    const editable = target.closest<HTMLElement>("[contenteditable=true]");
    if (target.closest("input,textarea,select,[contenteditable=plaintext-only]") || (editable && board.el.contains(editable)) || document.querySelector(".menu")) return;
    if ((e.ctrlKey || e.metaKey) && ["z", "y"].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopPropagation(); board.undo(e.key.toLowerCase() === "z" && !e.shiftKey); return; }
    const card = (e.target as Element).closest<HTMLElement>(".bases-kanban-card");
    if (picked) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelPicked(); }
      else if (e.key === "Tab") cancelPicked();
      else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); picked.column = Math.max(0, Math.min(board.columns().length - 1, picked.column + (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1))); say(picked.column); }
      else if (e.key === " ") { e.preventDefault(); e.stopPropagation(); const drop = picked; picked = null; board.move(drop.entry, drop.column); settled(); }
      return;
    }
    if (!card) return;
    const entry = board.entry(card.dataset.path!); if (!entry) return;
    const column = board.columns().findIndex(g => g.rows.includes(entry));
    if (e.key === " " || e.altKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault(); e.stopPropagation(); const reason = board.reason(entry); if (reason) { board.announce(reason); return; }
      if (e.altKey) board.move(entry, column + (e.key === "ArrowLeft" ? -1 : 1));
      else { picked = { entry, column }; say(column); }
    }
  }, { ...options, capture: true });
  board.el.addEventListener("focusout", e => { if (picked && (e.relatedTarget as Element | null)?.closest?.<HTMLElement>(".bases-kanban-card")?.dataset.path !== picked.entry.row.file.path) cancelPicked(); }, options);
  window.addEventListener("blur", cancelPicked, options);
  return {
    async idle() { while (tracking || picked) await new Promise<void>(resolve => waiting.push(resolve)); },
    /** True from pointer-down or Space until the gesture ends. A refresh must not treat that as idle. */
    active: () => tracking || picked !== null,
    cancel() { cancel?.(); cancelPicked(); settled(); },
    dispose() { cancel?.(); cancelPicked(); abort.abort(); settled(); },
  };
}
