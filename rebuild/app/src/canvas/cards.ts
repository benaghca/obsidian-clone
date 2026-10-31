import { EditorView } from "@codemirror/view";
import { readClipboardText } from "../editor/clipboard";
import { createNoteState } from "../editor/editor";
import { IMAGE_EXT } from "../editor/embeds";
import type { EditorHost } from "../editor/host";
import { loneWebUrl } from "../links/external";
import { noteName, parentDir } from "../paths";
import { confirmDialog } from "../shell/confirm";
import { dragPointer, h, keyButton } from "../shell/dom";
import { icon } from "../shell/icons";
import { closeMenu, showMenu, SEPARATOR, type MenuItems } from "../shell/menu";
import { hints, openPrompt, pickFrom, suggestionText } from "../shell/prompt";
import { switcherItems } from "../shell/switcherItems";
import type { Workspace } from "../workspace";
import { canvasReadOnly, canvasSettingsItems, isCardControl } from "./controls";
import type { CanvasEdge, CanvasNode } from "./model";

/** Where an added card lands, in board units. CZ5 passes the drag box; the menu passes the pointer. */
export interface CanvasAddPlace {
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** x/y is the top-left. Otherwise x/y is the center, as drag-to-add does. */
  atStart?: boolean;
}

export function canvasCards(el: HTMLElement, world: HTMLElement, ws: Workspace, add: (node: CanvasNode | CanvasNode[], edge?: CanvasEdge) => void) {
  let gone = false, controlClick = false, cancelDrag: (() => void) | undefined;
  let revision = 0, stopMenu: (() => void) | undefined;
  const point = (x?: number, y?: number) => {
    const r = el.getBoundingClientRect(), m = new DOMMatrix(getComputedStyle(world).transform);
    return { x: Math.round(((x ?? r.left + r.width / 2) - r.left - m.e) / m.a), y: Math.round(((y ?? r.top + r.height / 2) - r.top - m.f) / m.a) };
  };
  function insert(type: "text" | "file", p: { x: number; y: number }, width = 250, height = 60, file?: string, atStart = false, edge?: CanvasEdge) {
    if (gone || canvasReadOnly.has(el)) return;
    const node: CanvasNode = { id: crypto.randomUUID().replaceAll("-", "").slice(0, 16), x: Math.round(p.x - (atStart ? 0 : width / 2)), y: Math.round(p.y - (atStart ? 0 : height / 2)), width, height, type, ...(file ? { file } : { text: "" }) };
    if (edge) {
      const side = ({ top: "bottom", right: "left", bottom: "top", left: "right" } as const)[edge.fromSide ?? "right"];
      if (side === "left" || side === "right") node.x = p.x - (side === "right" ? width : 0);
      else node.y = p.y - (side === "bottom" ? height : 0);
      edge = { ...edge, toNode: node.id, toSide: side };
    }
    add(node, edge);
  }
  async function insertFile(file: string, p: { x: number; y: number }, atStart = false, edge?: CanvasEdge, place?: CanvasAddPlace) {
    const boxed = place?.width !== undefined && place.height !== undefined
      ? [Math.max(50, Math.round(place.width)), Math.max(50, Math.round(place.height))] as const : undefined;
    if (boxed || !IMAGE_EXT.test(file)) { insert("file", p, boxed?.[0] ?? 400, boxed?.[1] ?? 400, file, atStart, edge); return; }
    const mine = revision;
    const held = ws.embeds.image(file);
    try {
      const img = new Image(); img.src = await held.url; await img.decode();
      const ratio = 400 / Math.max(img.naturalWidth, img.naturalHeight);
      if (mine === revision) insert("file", p, Math.round(img.naturalWidth * ratio), Math.round(img.naturalHeight * ratio), file, atStart, edge);
    } catch (err) { console.warn(`Could not add ${file}`, err); }
    finally { held.release(); }
  }
  function pickNote(p = point(), edge?: CanvasEdge, place?: CanvasAddPlace) {
    const mine = revision;
    const at = place ?? p;
    const notes = edge ? ws.vault.files.filter(f => !f.is_dir && !ws.vault.isExcluded(f.path)).map(f => ({ ...f, name: noteName(f.path) })) : ws.vault.includedNotes();
    openPrompt({
      placeholder: "Find a note...", emptyText: "No notes found.", instructions: hints("to add"),
      items: query => switcherItems(query, notes, [...ws.recent, ...notes.map(n => n.path)], null).filter(item => item.path !== null),
      render: (item, row) => suggestionText(row, item.name, item.indices, parentDir(item.path!)),
      choose: item => { if (mine === revision) void insertFile(item.path!, at, !!place?.atStart, edge, place); },
    });
  }
  function pickMedia(p = point(), place?: CanvasAddPlace) {
    const mine = revision;
    const at = place ?? p;
    pickFrom(ws.vault.files.filter(f => !f.is_dir && IMAGE_EXT.test(f.path) && !ws.vault.isExcluded(f.path)), f => f.path, {
      placeholder: "Find media...", emptyText: "No media found.", enter: "to add",
      choose: file => { if (mine === revision) void insertFile(file.path, at, !!place?.atStart, undefined, place); },
    });
  }
  const sized = (place: CanvasAddPlace, width: number, height: number) => ({
    width: Math.max(50, Math.round(place.width ?? width)), height: Math.max(50, Math.round(place.height ?? height)),
  });
  function makeNode(type: CanvasNode["type"], place: CanvasAddPlace, width: number, height: number, extra: Partial<CanvasNode>): CanvasNode {
    const box = sized(place, width, height);
    const atStart = !!place.atStart;
    return {
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      x: Math.round(place.x - (atStart ? 0 : box.width / 2)), y: Math.round(place.y - (atStart ? 0 : box.height / 2)),
      width: box.width, height: box.height, type, ...extra,
    };
  }
  async function addWebPage(place: CanvasAddPlace) {
    if (gone || canvasReadOnly.has(el)) return;
    const mine = revision;
    const input = h("input", { class: "setting-input", type: "url", spellcheck: "false", placeholder: "Link address", "aria-label": "Web page URL" });
    const pending = confirmDialog({ title: "Add web page", message: input, confirm: "Add" });
    input.focus();
    const { ok } = await pending;
    const url = loneWebUrl(input.value);
    if (!ok || !url || gone || mine !== revision || canvasReadOnly.has(el)) return;
    add(makeNode("link", place, 400, 120, { url }));
  }
  async function pasteAt(place: CanvasAddPlace) {
    if (gone || canvasReadOnly.has(el)) return;
    const mine = revision;
    el.focus({ preventScroll: true });
    const text = await readClipboardText();
    if (gone || mine !== revision || canvasReadOnly.has(el)) return;
    const url = loneWebUrl(text);
    if (url) { add(makeNode("link", place, 400, 120, { url })); return; }
    if (!text.trim()) return;
    add(makeNode("text", place, 250, 60, { text }));
  }
  // One list for this menu and for Ctrl+drag (CZ5): card, note, media, web page, group.
  function addItems(place: CanvasAddPlace): MenuItems {
    const at = { x: place.x, y: place.y };
    const start = !!place.atStart;
    const box = sized(place, 250, 60);
    return [
      { title: "Add card", icon: "sticky-note", action: () => insert("text", at, box.width, box.height, undefined, start) },
      { title: "Add note from vault", icon: "file-text", action: () => pickNote(at, undefined, place) },
      { title: "Add media from vault", icon: "file-image", action: () => pickMedia(at, place) },
      { title: "Add web page", icon: "globe", action: () => void addWebPage(place) },
      { title: "Create group", icon: "group", action: () => add(makeNode("group", place, 400, 400, { label: "Untitled group" })) },
    ];
  }
  function boardMenu(x: number, y: number, history: { undo: boolean; redo: boolean; apply: (forward: boolean) => void }, refresh: () => void) {
    const place: CanvasAddPlace = { ...point(x, y), atStart: true };
    const writable = !canvasReadOnly.has(el);
    showMenu([
      ...(writable ? addItems(place) : []),
      SEPARATOR,
      { title: "Undo", icon: "undo-2", disabled: !writable || !history.undo, action: () => history.apply(false) },
      history.redo && { title: "Redo", icon: "redo-2", disabled: !writable, action: () => history.apply(true) },
      SEPARATOR,
      writable && { title: "Paste", icon: "clipboard-paste", action: () => void pasteAt(place) },
      SEPARATOR,
      ...canvasSettingsItems(el, refresh),
    ], { x, y }, { className: "canvas-context-menu" });
  }
  // Tree order, folders removed. One file keeps image aspect; several share one 400px row.
  const CARD = 400, GAP = 45;
  function droppedFiles(paths: readonly string[] | undefined, entry: { path: string; is_dir: boolean }): string[] {
    const dragged = paths?.length ? paths : [entry.path];
    const known = new Map(ws.vault.files.map(f => [f.path, f.is_dir]));
    return dragged.filter(path => known.has(path) ? !known.get(path) : path === entry.path && !entry.is_dir);
  }
  function dropFiles(files: string[], p: { x: number; y: number }) {
    if (gone || canvasReadOnly.has(el) || !files.length) return;
    if (files.length === 1) { void insertFile(files[0], p, true); return; }
    add(files.map((file, i) => ({
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      x: Math.round(p.x + i * (CARD + GAP)), y: Math.round(p.y), width: CARD, height: CARD, type: "file" as const, file,
    })));
  }
  const explorerDrag = (event: Event) => {
    const { entry, paths, x, y, done, cancelled } = (event as CustomEvent<{ entry: { path: string; is_dir: boolean }; paths?: string[]; x: number; y: number; done?: boolean; cancelled?: boolean }>).detail;
    const files = droppedFiles(paths, entry);
    el.classList.toggle("is-explorer-dragging", !done);
    const over = document.elementFromPoint(x, y);
    const inside = !gone && files.length > 0 && !canvasReadOnly.has(el) && !!over && el.contains(over) && !over.closest(".canvas-controls, .canvas-card-menu, .canvas-selection-menu");
    el.classList.toggle("is-file-drop", !done && inside);
    // Run after the explorer restores the pre-drag focus, so Undo follows the drop.
    if (done && !cancelled && inside) queueMicrotask(() => dropFiles(files, point(x, y)));
  };
  window.addEventListener("grove:explorer-drag", explorerDrag);
  function connect(edge: CanvasEdge, at: { x: number; y: number }, finished: () => void) {
    stopMenu?.();
    const p = point(at.x, at.y), mine = revision;
    showMenu([
      { title: "Add card", action: () => { if (mine === revision) insert("text", p, 250, 60, undefined, false, edge); } },
      { title: "Add note from vault", action: () => { if (mine === revision) pickNote(p, edge); } },
    ], at, { className: "canvas-add-menu" });
    const menu = document.querySelector(".canvas-add-menu")!;
    const closed = new MutationObserver(() => { if (!menu.isConnected) stopMenu?.(); });
    stopMenu = () => { closed.disconnect(); if (menu.isConnected) closeMenu(); stopMenu = undefined; finished(); };
    closed.observe(document.body, { childList: true });
  }
  function reset() { revision++; stopMenu?.(); }
  const toolbar = h("div", { class: "canvas-card-menu", role: "toolbar", "aria-label": "Add cards" });
  for (const [label, glyph, action] of [
    ["Drag to add card", "sticky-note", (p: { x: number; y: number }) => insert("text", p)],
    ["Drag to add note from vault", "file-text", pickNote],
    ["Drag to add media from vault", "file-image", pickMedia],
  ] as const) {
    let dragged = false;
    const run = (p = point()) => { el.focus({ preventScroll: true }); action(p); };
    const button = keyButton(icon(glyph, 24), label, e => { if (!dragged || e.type === "keydown") run(); });
    button.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      dragged = false; cancelDrag?.();
      let drop = point(e.clientX, e.clientY), end = e;
      cancelDrag = dragPointer(e, button, move => {
        dragged ||= Math.hypot(move.clientX - e.clientX, move.clientY - e.clientY) >= 3;
        end = move; drop = point(move.clientX, move.clientY);
      }, cancelled => { cancelDrag = undefined; if (dragged && !cancelled && el.contains(document.elementFromPoint(end.clientX, end.clientY))) run(drop); }, false);
    });
    toolbar.append(button);
  }
  el.append(toolbar);
  // Remember the first target even when its action removes the toolbar.
  const click = (e: MouseEvent) => { if (e.detail === 1) controlClick = !!(e.target as Element).closest(".canvas-controls, .canvas-card-menu, .canvas-selection-menu"); };
  const doubleClick = (e: MouseEvent) => {
    if (e.isTrusted && !e.defaultPrevented && !controlClick && !el.classList.contains("is-grabbable") && !(e.target as Element).closest(".canvas-node, [data-edge-id], .canvas-controls, .canvas-card-menu, .canvas-selection-menu")) insert("text", point(e.clientX, e.clientY));
  };
  el.addEventListener("click", click, true);
  el.addEventListener("dblclick", doubleClick);
  const controlDouble = (e: MouseEvent) => { if (controlClick) { e.preventDefault(); e.stopImmediatePropagation(); } };
  el.addEventListener("dblclick", controlDouble, true);
  const menuClick = (e: MouseEvent) => { if (e.detail === 1 && (e.target as Element).closest(".canvas-add-menu, .canvas-context-menu, .canvas-group-menu")) controlClick = true; };
  document.addEventListener("click", menuClick, true);
  return { connect, reset, addItems, boardMenu, dispose() { gone = true; reset(); cancelDrag?.(); toolbar.remove(); document.removeEventListener("click", menuClick, true); window.removeEventListener("grove:explorer-drag", explorerDrag); el.removeEventListener("click", click, true); el.removeEventListener("dblclick", doubleClick); el.removeEventListener("dblclick", controlDouble, true); } };
}

// A temporary note editor owns only the card's Markdown, never a vault note.
export function editTextCard(card: HTMLElement, content: HTMLElement, text: string, host: EditorHost,
  changed: (text: string) => void, finished: (paint: boolean) => void) {
  const events = new AbortController();
  let stopped = false;
  const stop = (paint = true) => {
    if (stopped) return;
    stopped = true; events.abort(); view.destroy(); card.classList.remove("is-editing"); finished(paint);
  };
  content.replaceChildren(); content.classList.remove("is-reading-mode"); card.classList.add("is-editing");
  const view = new EditorView({ parent: content, state: createNoteState({ doc: text, host, extensions: [
    EditorView.updateListener.of(update => { if (update.docChanged) changed(update.state.doc.toString()); }),
  ] }) });
  view.dom.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    e.preventDefault(); e.stopPropagation(); stop(); card.closest<HTMLElement>(".canvas-view")?.focus();
  }, { capture: true, signal: events.signal });
  document.addEventListener("pointerdown", e => { if (!card.contains(e.target as Node) && !isCardControl(e.target)) stop(); }, { capture: true, signal: events.signal });
  view.focus();
  return stop;
}
