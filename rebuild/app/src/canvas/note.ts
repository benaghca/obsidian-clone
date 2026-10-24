import { EditorView } from "@codemirror/view";
import { isCardControl } from "./controls";
import { embedPart } from "../editor/embeds";
import { h } from "../shell/dom";
import type { Group } from "../tabs";
import type { Workspace } from "../workspace";

// The board owns the temporary surface; NoteEditors owns the note and its undo/save.
export function editNoteCard(card: HTMLElement, content: HTMLElement, ws: Workspace, group: Group,
  path: string, subpath: string | undefined, line: number, finished: (paint: boolean) => void) {
  const events = new AbortController();
  let stopped = false, embedded: ReturnType<typeof ws.editors.embed> | undefined;
  const board = card.closest<HTMLElement>(".canvas-view")!;
  const title = content.querySelector(".canvas-note-title");
  const parent = h("div", { class: "canvas-note-editor" });
  content.replaceChildren(...(title ? [title, parent] : [parent])); content.classList.remove("is-reading-mode");
  card.classList.add("is-editing");
  const stop = (paint = true) => {
    if (stopped) return;
    stopped = true; events.abort(); embedded?.dispose(); card.classList.remove("is-editing");
    void ws.editors.flush(p => p === path); finished(paint);
  };
  void ws.editors.load(path).then(state => {
    if (stopped) return;
    if (!state) { stop(); return; }
    embedded = ws.editors.embed(group, path, parent, content);
    const view = embedded.view, shown = embedPart(view.state.doc.toString(), subpath?.replace(/^#/, "") ?? "");
    const at = view.state.doc.line(Math.min(view.state.doc.lines, (shown?.line ?? 0) + line)).from;
    view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at) });
    view.focus();
  });
  board.addEventListener("keydown", e => {
    if (e.key !== "Escape" || embedded && !card.contains(e.target as Node)) return;
    e.preventDefault(); e.stopPropagation(); stop(); board.focus();
  }, { capture: true, signal: events.signal });
  document.addEventListener("pointerdown", e => { if (!card.contains(e.target as Node) && !isCardControl(e.target)) stop(); }, { capture: true, signal: events.signal });
  return stop;
}
