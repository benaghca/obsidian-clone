// One delayed, local page preview, shared by editors and sidebar results.
// A detached read-only view supplies NoteEmbedWidget's rendering context;
// no view, file read or syntax lookup is created until an eligible hover.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { NoteEmbedWidget, splitSubpath } from "../editor/embeds";
import { editorHost } from "../editor/host";
import { linkAt } from "../editor/linkAt";
import { readingMode } from "../editor/render";
import { isNotePath } from "../links/external";
import { resolveLink } from "../links/internal";
import type { Workspace } from "../workspace";
import { h } from "./dom";

export function installHoverPreviews(ws: Workspace) {
  let pending = 0;
  let leaving = 0;
  let key = "";
  let popup: HTMLElement | null = null;
  let dispose: (() => void) | null = null;
  let unlisten: (() => void) | null = null;
  const cancel = () => { clearTimeout(leaving); clearTimeout(pending); };
  const close = () => {
    if (!key) return;
    cancel();
    key = "";
    popup?.remove();
    popup = null;
    dispose?.();
    dispose = null;
    unlisten?.();
    unlisten = null;
  };
  const leave = () => {
    if (!key) return;
    clearTimeout(pending);
    pending = 0;
    clearTimeout(leaving);
    leaving = window.setTimeout(close, 180);
  };

  function show(target: string, from: string | null, source: EditorView, rect: DOMRect) {
    const host = source.state.facet(editorHost);
    if (!host) return close();
    const [name, sub] = splitSubpath(target);
    const path = name ? ws.resolve(name, from) : from;
    if (path && !/\.md$/i.test(path)) return close();
    const origin = path ?? from;
    const resolve = (href: string) => resolveLink(href, origin, ws.vault.files.filter((f) => !f.is_dir));
    const context = new EditorView({ state: EditorState.create({ extensions: [
      EditorState.readOnly.of(true), readingMode.of(true), editorHost.of({
        ...host,
        contextMenu: undefined,
        openLink: (href, where) => {
          const [note, anchor] = splitSubpath(href);
          host.openLink(`${note ? resolve(note) ?? note : origin ?? ""}${anchor ? `#${anchor}` : ""}`, where, source);
          close();
        },
        linkExists: (href) => !!resolve(href),
        embeds: { ...ws.embeds, pathOf: () => null, resolve: (href) => resolve(href), toggleTask: () => {} },
      }),
    ] }) });
    // Decode Markdown anchors without making malformed percent escapes an error.
    try { target = `${path ?? name}#${decodeURIComponent(sub)}`; } catch { target = `${path ?? name}#${sub}`; }
    const widget = new NoteEmbedWidget(target, path, [], true);
    const dom = widget.toDOM(context);
    popup = h("div", { class: "hover-popover is-reading-mode", role: "dialog", "aria-label": "Page preview" }, dom);
    popup.addEventListener("mouseenter", cancel);
    popup.addEventListener("mouseleave", leave);
    popup.addEventListener("click", (event) => {
      const link = (event.target as Element).closest<HTMLElement>("[data-href]");
      if (!link || !event.isTrusted) return;
      event.preventDefault();
      const href = link.dataset.href!;
      const local = isNotePath(href) || href.startsWith("#");
      if (local) context.state.facet(editorHost)!.openLink(href, event.ctrlKey || event.metaKey ? "tab" : false);
      else { host.openUrl(href); close(); }
    });
    dispose = () => { widget.destroy(dom); context.destroy(); };
    document.body.append(popup);
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(rect.bottom + 6 + height <= innerHeight - 8 ? rect.bottom + 6 : rect.top - height - 6, innerHeight - height - 8))}px`;
  }

  document.addEventListener("mousemove", (event) => {
    const el = event.target as HTMLElement;
    if (popup?.contains(el)) return cancel();
    const view = EditorView.findFromDOM(el);
    const modified = /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
    if (!modified && !view?.state.facet(readingMode)) return leave();
    const sidebar = el.closest<HTMLElement>("[data-preview-path]");
    const link = el.closest<HTMLElement>("[data-href]");
    let target = sidebar?.dataset.previewPath ?? link?.dataset.href;
    let rect = (sidebar ?? link)?.getBoundingClientRect();
    if (!target && view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const found = pos === null ? null : linkAt(view.state, pos);
      if (found?.kind === "internal") {
        target = found.target;
        const a = view.coordsAtPos(found.from), b = view.coordsAtPos(found.to);
        if (a && b) rect = new DOMRect(a.left, a.top, Math.max(1, b.right - a.left), a.bottom - a.top);
      }
    }
    if (!target || !rect || !(isNotePath(target) || target.startsWith("#"))) return leave();
    const source = view ?? ws.view;
    const from = sidebar ? null : ws.editors.pathOf(source);
    const next = `${from}\n${target}\n${rect.x},${rect.y}`;
    if (key === next) {
      clearTimeout(leaving);
      if (popup || pending) return;
    } else close();
    key = next;
    if (!unlisten) {
      const controller = new AbortController();
      const { signal } = controller;
      const off = ws.on((change) => { if (change === "show" || change === "mode" || change === "files") close(); });
      // Dismissal listeners exist only during a hover, never during ordinary typing.
      unlisten = () => { controller.abort(); off(); };
      document.addEventListener("keydown", (event) => {
        if (!["Control", "Meta", "Shift", "Alt"].includes(event.key)) close();
      }, { capture: true, signal });
      document.addEventListener("input", close, { capture: true, signal });
      document.addEventListener("scroll", (event) => { if (!popup?.contains(event.target as Node)) close(); }, { capture: true, signal });
      document.addEventListener("mousedown", (event) => { if (!popup?.contains(event.target as Node)) close(); }, { capture: true, signal });
      window.addEventListener("blur", close, { signal });
      window.addEventListener("resize", close, { signal });
    }
    pending = window.setTimeout(() => {
      pending = 0;
      show(target!, from, source, rect!);
    }, 350);
  });
  document.addEventListener("mouseout", (event) => { if (!event.relatedTarget) leave(); });
}
