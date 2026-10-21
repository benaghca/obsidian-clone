// The two collapsible side docks: files on the left, backlinks and outline
// on the right. Each dock animates its own width (its one layout
// transition, 130ms ease-out like Obsidian's). Its contents keep their full
// width and are clipped, so nothing inside re-wraps, and the pane holds the
// note column's wrap width for the length of the move, so the text slides
// over as one block instead of re-flowing every frame.

import { listeners } from "../listeners";
import { duration } from "../motion";

export type Side = "left" | "right";

export const MIN_DOCK_WIDTH = 160;
export const MAX_DOCK_WIDTH = 560;

export interface Sidedocks {
  isCollapsed(side: Side): boolean;
  setCollapsed(side: Side, collapsed: boolean, animate?: boolean): void;
  toggle(side: Side): void;
  width(side: Side): number;
  setWidth(side: Side, px: number): void;
  /** A drag handle that resizes the dock, for its inner edge. */
  resizeHandle(side: Side): HTMLElement;
  /** Called after a dock opens, closes or is resized by the user. */
  onChange(fn: (side: Side) => void): void;
}

export interface ColumnHolder {
  /**
   * The pane is about to change width by `delta` px, following `dock`'s
   * width transition: keep the note column from re-wrapping on the way.
   */
  holdColumn(delta: number, dock?: Animation): void;
}

const clampWidth = (px: number) => Math.round(Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, px)));

export function createSidedocks(app: HTMLElement, pane: ColumnHolder): Sidedocks {
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

  function resizeHandle(side: Side): HTMLElement {
    const handle = document.createElement("div");
    handle.className = "workspace-leaf-resize-handle";
    handle.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      handle.setPointerCapture(down.pointerId);
      const startX = down.clientX;
      const startWidth = width(side);
      const sign = side === "left" ? 1 : -1;
      let frame = 0;
      let x = startX;
      app.classList.add("is-sidedock-resizing");
      const move = (e: PointerEvent) => {
        x = e.clientX;
        frame ||= requestAnimationFrame(() => {
          frame = 0;
          setWidth(side, startWidth + sign * (x - startX));
        });
      };
      const up = () => {
        cancelAnimationFrame(frame);
        setWidth(side, startWidth + sign * (x - startX));
        app.classList.remove("is-sidedock-resizing");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        changes.emit(side);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    return handle;
  }

  return {
    isCollapsed,
    setCollapsed,
    toggle: (side) => setCollapsed(side, !isCollapsed(side)),
    width,
    setWidth,
    resizeHandle,
    onChange: changes.on,
  };
}
