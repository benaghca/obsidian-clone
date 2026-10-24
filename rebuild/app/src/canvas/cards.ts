import { EditorView } from "@codemirror/view";
import { createNoteState } from "../editor/editor";
import { IMAGE_EXT } from "../editor/embeds";
import type { EditorHost } from "../editor/host";
import { noteName, parentDir } from "../paths";
import { dragPointer, h, keyButton } from "../shell/dom";
import { icon } from "../shell/icons";
import { closeMenu, showMenu } from "../shell/menu";
import { hints, openPrompt, pickFrom, suggestionText } from "../shell/prompt";
import { switcherItems } from "../shell/switcherItems";
import type { Workspace } from "../workspace";
import { canvasReadOnly } from "./controls";
import type { CanvasEdge, CanvasNode } from "./model";

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
  async function insertFile(file: string, p: { x: number; y: number }, atStart = false, edge?: CanvasEdge) {
    if (!IMAGE_EXT.test(file)) { insert("file", p, 400, 400, file, atStart, edge); return; }
    const mine = revision;
    const held = ws.embeds.image(file);
    try {
      const img = new Image(); img.src = await held.url; await img.decode();
      const ratio = 400 / Math.max(img.naturalWidth, img.naturalHeight);
      if (mine === revision) insert("file", p, Math.round(img.naturalWidth * ratio), Math.round(img.naturalHeight * ratio), file, atStart, edge);
    } catch (err) { console.warn(`Could not add ${file}`, err); }
    finally { held.release(); }
  }
  function pickNote(p = point(), edge?: CanvasEdge) {
    const mine = revision;
    const notes = edge ? ws.vault.files.filter(f => !f.is_dir && !ws.vault.isExcluded(f.path)).map(f => ({ ...f, name: noteName(f.path) })) : ws.vault.includedNotes();
    openPrompt({
      placeholder: "Find a note...", emptyText: "No notes found.", instructions: hints("to add"),
      items: query => switcherItems(query, notes, [...ws.recent, ...notes.map(n => n.path)], null).filter(item => item.path !== null),
      render: (item, row) => suggestionText(row, item.name, item.indices, parentDir(item.path!)),
      choose: item => { if (mine === revision) void insertFile(item.path!, p, false, edge); },
    });
  }
  function pickMedia(p = point()) {
    const mine = revision;
    pickFrom(ws.vault.files.filter(f => !f.is_dir && IMAGE_EXT.test(f.path) && !ws.vault.isExcluded(f.path)), f => f.path, {
      placeholder: "Find media...", emptyText: "No media found.", enter: "to add",
      choose: file => { if (mine === revision) void insertFile(file.path, p); },
    });
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
  const menuClick = (e: MouseEvent) => { if (e.detail === 1 && (e.target as Element).closest(".canvas-add-menu, .canvas-context-menu")) controlClick = true; };
  document.addEventListener("click", menuClick, true);
  return { connect, reset, dispose() { gone = true; reset(); cancelDrag?.(); toolbar.remove(); document.removeEventListener("click", menuClick, true); window.removeEventListener("grove:explorer-drag", explorerDrag); el.removeEventListener("click", click, true); el.removeEventListener("dblclick", doubleClick); el.removeEventListener("dblclick", controlDouble, true); } };
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
  document.addEventListener("pointerdown", e => { if (!card.contains(e.target as Node)) stop(); }, { capture: true, signal: events.signal });
  view.focus();
  return stop;
}
