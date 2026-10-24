import { EditorView } from "@codemirror/view";
import { createNoteState } from "../editor/editor";
import { IMAGE_EXT } from "../editor/embeds";
import type { EditorHost } from "../editor/host";
import { parentDir } from "../paths";
import { dragPointer, h, keyButton } from "../shell/dom";
import { icon } from "../shell/icons";
import { hints, openPrompt, pickFrom, suggestionText } from "../shell/prompt";
import { switcherItems } from "../shell/switcherItems";
import type { Workspace } from "../workspace";
import { canvasReadOnly } from "./controls";
import type { CanvasNode } from "./model";

export function canvasCards(el: HTMLElement, world: HTMLElement, ws: Workspace, add: (node: CanvasNode) => void) {
  let gone = false, controlClick = false, cancelDrag: (() => void) | undefined;
  const point = (x?: number, y?: number) => {
    const r = el.getBoundingClientRect(), m = new DOMMatrix(getComputedStyle(world).transform);
    return { x: Math.round(((x ?? r.left + r.width / 2) - r.left - m.e) / m.a), y: Math.round(((y ?? r.top + r.height / 2) - r.top - m.f) / m.a) };
  };
  function insert(type: "text" | "file", p: { x: number; y: number }, width = 250, height = 60, file?: string, atStart = false) {
    if (gone || canvasReadOnly.has(el)) return;
    add({ id: crypto.randomUUID().replaceAll("-", "").slice(0, 16), x: Math.round(p.x - (atStart ? 0 : width / 2)), y: Math.round(p.y - (atStart ? 0 : height / 2)), width, height, type, ...(file ? { file } : { text: "" }) });
  }
  async function insertFile(file: string, p: { x: number; y: number }, atStart = false) {
    if (!IMAGE_EXT.test(file)) { insert("file", p, 400, 400, file, atStart); return; }
    const held = ws.embeds.image(file);
    try {
      const img = new Image(); img.src = await held.url; await img.decode();
      const ratio = 400 / Math.max(img.naturalWidth, img.naturalHeight);
      insert("file", p, Math.round(img.naturalWidth * ratio), Math.round(img.naturalHeight * ratio), file, atStart);
    } catch (err) { console.warn(`Could not add ${file}`, err); }
    finally { held.release(); }
  }
  function pickNote(p = point()) {
    const notes = ws.vault.includedNotes();
    openPrompt({
      placeholder: "Find a note...", emptyText: "No notes found.", instructions: hints("to add"),
      items: query => switcherItems(query, notes, [...ws.recent, ...notes.map(n => n.path)], null).filter(item => item.path !== null),
      render: (item, row) => suggestionText(row, item.name, item.indices, parentDir(item.path!)),
      choose: item => insert("file", p, 400, 400, item.path!),
    });
  }
  function pickMedia(p = point()) {
    pickFrom(ws.vault.files.filter(f => !f.is_dir && IMAGE_EXT.test(f.path) && !ws.vault.isExcluded(f.path)), f => f.path, {
      placeholder: "Find media...", emptyText: "No media found.", enter: "to add",
      choose: file => insertFile(file.path, p),
    });
  }
  const explorerDrag = (event: Event) => {
    const { entry, x, y, done, cancelled } = (event as CustomEvent<{ entry: { path: string; is_dir: boolean }; x: number; y: number; done?: boolean; cancelled?: boolean }>).detail;
    const over = document.elementFromPoint(x, y);
    const inside = !gone && !entry.is_dir && !canvasReadOnly.has(el) && el.contains(over) && !over?.closest(".canvas-controls, .canvas-card-menu, .canvas-selection-menu");
    el.classList.toggle("is-file-drop", !done && inside);
    if (done && !cancelled && inside) void insertFile(entry.path, point(x, y), true);
  };
  window.addEventListener("grove:explorer-drag", explorerDrag);
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
  return () => { gone = true; cancelDrag?.(); toolbar.remove(); window.removeEventListener("grove:explorer-drag", explorerDrag); el.removeEventListener("click", click, true); el.removeEventListener("dblclick", doubleClick); };
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
