// The two collapsible side docks: files on the left, backlinks and outline
// on the right. Each dock animates its own width (its one layout
// transition, 130ms ease-out like Obsidian's). Its contents keep their full
// width and are clipped, so nothing inside re-wraps, and the pane holds the
// note column's wrap width for the length of the move, so the text slides
// over as one block instead of re-flowing every frame.

import { listeners } from "../listeners";
import { duration } from "../motion";
import { dragPointer, h } from "./dom";
import type { Panes } from "./pane";

export type Side = "left" | "right";

const MIN_DOCK_WIDTH = 160;
const MAX_DOCK_WIDTH = 560;

export type Sidedocks = ReturnType<typeof createSidedocks>;

const clampWidth = (px: number) => Math.round(Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, px)));

export function createSidedocks(app: HTMLElement, pane: Pick<Panes, "holdColumn">) {
  const collapsedClass = (side: Side) => `is-${side}-sidebar-collapsed`;
  const dock = (side: Side) => app.querySelector<HTMLElement>(`.mod-${side}-split`)!;
  const changes = listeners<[Side]>();

  const isCollapsed = (side: Side) => app.classList.contains(collapsedClass(side));

  const width = (side: Side) => parseFloat(getComputedStyle(dock(side)).getPropertyValue("--dock-width")) || 200;

  // Jumps without animating (restoring saved layout on startup).
  function instantly(fn: () => void) {
    app.classList.add("is-sidedock-instant");
    fn();
    void app.offsetWidth; // apply the new layout with transitions off
    app.classList.remove("is-sidedock-instant");
  }

  function setCollapsed(side: Side, collapsed: boolean, animate = true) {
    if (isCollapsed(side) === collapsed) return;
    const ms = duration("sidebar");
    if (!animate || ms <= 0) {
      instantly(() => app.classList.toggle(collapsedClass(side), collapsed));
    } else {
      // From wherever the dock is now (it may be mid-move) to its target.
      const el = dock(side);
      const now = el.getBoundingClientRect().width;
      app.classList.toggle(collapsedClass(side), collapsed);
      const transition = el
        .getAnimations()
        .find((a): a is CSSTransition => a instanceof CSSTransition && a.transitionProperty === "width");
      pane.holdColumn(now - (collapsed ? 0 : width(side)), transition);
    }
    changes.emit(side);
  }

  function setWidth(side: Side, px: number) {
    app.style.setProperty(`--${side}-sidebar-width`, `${clampWidth(px)}px`);
  }

  /** A drag handle that resizes the dock, for its inner edge. */
  function resizeHandle(side: Side): HTMLElement {
    const handle = h("div", { class: "workspace-leaf-resize-handle" });
    handle.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      const startWidth = width(side);
      const sign = side === "left" ? 1 : -1;
      app.classList.add("is-sidedock-resizing");
      dragPointer(down, handle, (e) => setWidth(side, startWidth + sign * (e.clientX - down.clientX)), () => {
        app.classList.remove("is-sidedock-resizing");
        changes.emit(side);
      });
    });
    return handle;
  }

  return {
    isCollapsed,
    setCollapsed,
    toggle: (side: Side) => setCollapsed(side, !isCollapsed(side)),
    width,
    setWidth,
    resizeHandle,
    /** Called after a dock opens, closes or is resized by the user. */
    onChange: changes.on,
  };
}
