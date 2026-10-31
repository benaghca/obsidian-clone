// One delayed, local page preview, shared by editors, sidebar results and canvas cards.
// A detached read-only view supplies NoteEmbedWidget's rendering context;
// no view, file read or syntax lookup is created until an eligible hover.
// Canvas clicks call preventDefault on pointerdown, and WebKitGTK can keep
// suppressing the compatibility mousemove after that. Pointer events are not
// suppressed, so the hover listens to those. The popover is appended to the
// body in viewport coordinates so a canvas world's transform cannot scale or clip it.
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { NoteEmbedWidget, splitSubpath } from "../editor/embeds";
import { editorHost } from "../editor/host";
import { linkAt } from "../editor/linkAt";
import { readingMode } from "../editor/render";
import { isNotePath } from "../links/external";
import { isNoteFile } from "../paths";
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

  function show(target: string, from: string | null, source: EditorView, rect: DOMRect, side?: DOMRect) {
    const host = source.state.facet(editorHost);
    if (!host) return close();
    const [name, sub] = splitSubpath(target);
    const path = name ? ws.resolve(name, from) : from;
    if (path && !isNoteFile(path)) return close();
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
    popup.addEventListener("pointerenter", cancel);
    popup.addEventListener("pointerleave", leave);
    popup.addEventListener("click", (event) => {
      const link = (event.target as Element).closest<HTMLElement>("[data-href]");
      if (!link || !event.isTrusted) return;
      event.preventDefault();
      const href = link.dataset.href!;
      const local = isNotePath(href) || href.startsWith("#");
      if (local) context.state.facet(editorHost)!.openLink(href, event.ctrlKey || event.metaKey ? "tab" : false);
      else { host.openUrl(href); close(); }
    });
    // Body, not the card: the canvas world is transformed and overflow-hidden.
    document.body.append(popup);
    const toRight = side && innerWidth - side.right >= side.left;
    if (side) popup.style.width = `${Math.max(0, Math.min(popup.offsetWidth, (toRight ? innerWidth - side.right : side.left) - 14))}px`;
    const place = () => {
      if (!popup) return;
      const width = popup.offsetWidth, height = popup.offsetHeight;
      const left = side ? (toRight ? side.right + 6 : side.left - width - 6) : rect.left;
      const top = side ? rect.top : rect.bottom + 6 + height <= innerHeight - 8 ? rect.bottom + 6 : rect.top - height - 6;
      popup.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
      popup.style.top = `${Math.max(8, Math.min(top, innerHeight - height - 8))}px`;
    };
    // The existing embed fills asynchronously; keep its growing box inside the viewport.
    const size = new ResizeObserver(place);
    size.observe(popup);
    place();
    dispose = () => { size.disconnect(); widget.destroy(dom); context.destroy(); };
  }

  const hoverModifier = (event: { ctrlKey: boolean; metaKey: boolean }) =>
    /Mac|iPhone|iPad/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
  let pointerX = 0, pointerY = 0, pointerSeen = false;

  function inspect(x: number, y: number, modified: boolean, el: HTMLElement | null) {
    if (!el || typeof el.closest !== "function") return leave();
    if (popup?.contains(el)) return cancel();
    const view = EditorView.findFromDOM(el);
    const allowed = modified || !!view?.state.facet(readingMode);
    if (!allowed && !popup) return leave();
    const sidebar = el.closest<HTMLElement>("[data-preview-path]");
    const link = el.closest<HTMLElement>("[data-href]");
    let target = sidebar?.dataset.previewPath ?? link?.dataset.href;
    let rect = (sidebar ?? link)?.getBoundingClientRect();
    if (!target && view) {
      const pos = view.posAtCoords({ x, y });
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
    } else {
      if (!allowed) return leave();
      close();
    }
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
      // A canvas click preventDefault's pointerdown, which can swallow the mousedown that used to dismiss.
      document.addEventListener("pointerdown", (event) => { if (!popup?.contains(event.target as Node)) close(); }, { capture: true, signal });
      // Ctrl+wheel zooms the canvas without scrolling, so a wheel has to dismiss on its own.
      document.addEventListener("wheel", (event) => { if (!popup?.contains(event.target as Node)) close(); }, { capture: true, signal });
      window.addEventListener("blur", close, { signal });
      window.addEventListener("resize", close, { signal });
    }
    pending = window.setTimeout(() => {
      pending = 0;
      show(target!, from, source, rect!, sidebar?.closest(".workspace-split.mod-sidedock")?.getBoundingClientRect());
    }, 350);
  }

  document.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerSeen = true;
    // A drag or pan owns the pointer. Don't start a preview under it.
    if (event.buttons && !popup && !pending) return;
    const raw = event.target as HTMLElement | null;
    inspect(event.clientX, event.clientY, hoverModifier(event), raw && typeof raw.closest === "function" ? raw : null);
  }, { capture: true, passive: true });
  // Ctrl (Cmd on macOS) while the pointer is already still, with no further move.
  document.addEventListener("keydown", (event) => {
    if (!pointerSeen || event.repeat) return;
    const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control";
    if (event.key !== modifier) return;
    inspect(pointerX, pointerY, true, document.elementFromPoint(pointerX, pointerY) as HTMLElement | null);
  });
  document.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    if (!event.relatedTarget) leave();
  }, { capture: true });
}
