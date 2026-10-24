// Explorer moves use the tab drag's threshold/ghost and the shared pointer
// driver. Measure rows at drag start, then only again after auto-expansion;
// scrolling changes their offset, not their measured content coordinates.
import type { FileEntry } from "../api";
import { moveFile } from "../fileOps";
import { fileName, isUnder, noteName, parentDir } from "../paths";
import type { Workspace } from "../workspace";
import { dragPointer, h } from "./dom";
import { dragGhost, THRESHOLD } from "./tabDrag";

type Entry = Pick<FileEntry, "path" | "is_dir">;

/** Empty tree space means root; files mean their parent; a folder cannot contain itself. */
export function treeDropTarget(dragged: Entry, over: Entry | null): string | null {
  const folder = over ? over.is_dir ? over.path : parentDir(over.path) : "";
  return dragged.is_dir && isUnder(folder.toLowerCase(), dragged.path.toLowerCase()) ? null : folder;
}

/** Observed edge speeds: about 200/500/1600 px/s at 40/25/10 px. */
export function treeScrollSpeed(distance: number): number {
  return distance > 40 ? 0 : distance >= 25 ? 200 + (40 - distance) * 20 : 500 + (25 - Math.max(0, distance)) * 1100 / 15;
}

export function startTreeDrag(down: PointerEvent, entry: FileEntry, list: HTMLElement, ws: Workspace, expand: (path: string) => void) {
  const row = down.currentTarget as HTMLElement;
  const focus = document.activeElement as HTMLElement | null;
  // Keep the editor's selection/focus, including on Escape; a click still opens the row.
  down.preventDefault();
  let ghost: HTMLElement | null = null;
  const destination = h("span", { class: "drag-ghost-destination" });
  let bounds: DOMRect;
  let measured: { entry: FileEntry; row: HTMLElement; top: number; bottom: number; collapsed: boolean }[] = [];
  let x = down.clientX, y = down.clientY;
  let target: string | null = null;
  let highlight: HTMLElement | null = null;
  let hover = "", timer = 0, scrollFrame = 0, lastTime = 0, velocity = 0;
  const listening = new AbortController();

  function measure() {
    bounds = list.getBoundingClientRect();
    const entries = new Map(ws.vault.files.map((f) => [f.path, f]));
    measured = [...list.querySelectorAll<HTMLElement>(".tree-item-self[data-path]")].flatMap((row) => {
      const entry = entries.get(row.dataset.path!);
      if (!entry) return [];
      const r = row.getBoundingClientRect();
      return [{ entry, row, top: r.top - bounds.top + list.scrollTop, bottom: r.bottom - bounds.top + list.scrollTop, collapsed: !!row.querySelector(".collapse-icon.is-collapsed") }];
    });
  }

  function paint() {
    if (!ghost) return;
    ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
    const inside = x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    const at = y - bounds.top + list.scrollTop;
    const over = inside ? measured.find((m) => at >= m.top && at < m.bottom) : undefined;
    target = inside ? treeDropTarget(entry, over?.entry ?? null) : null;
    const next = target === null ? null : target === "" ? list : measured.find((m) => m.entry.path === target)?.row.parentElement ?? null;
    if (next !== highlight) {
      highlight?.classList.remove("is-being-dragged-over");
      highlight = next;
      highlight?.classList.add("is-being-dragged-over");
    }
    destination.hidden = target === null;
    destination.textContent = target === null ? "" : `Move into “${target ? fileName(target) : ws.vault.name}”`;
    window.dispatchEvent(new CustomEvent("grove:explorer-drag", { detail: { entry, x, y } }));
    const folder = target !== null && over?.collapsed ? over.entry.path : "";
    if (folder !== hover) {
      clearTimeout(timer);
      hover = folder;
      if (folder) timer = window.setTimeout(() => {
        timer = 0;
        expand(folder);
        measure();
        paint();
        scroll();
      }, 750);
    }
  }

  function tick(now: number) {
    scrollFrame = 0;
    const before = list.scrollTop;
    list.scrollTop += velocity * Math.min(50, now - lastTime) / 1000;
    lastTime = now;
    paint();
    if (list.scrollTop !== before) scrollFrame = requestAnimationFrame(tick);
  }

  function scroll() {
    velocity = x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom ? 0
      : y < bounds.top + 40 ? -treeScrollSpeed(y - bounds.top)
      : y > bounds.bottom - 40 ? treeScrollSpeed(bounds.bottom - y) : 0;
    if (!velocity) { cancelAnimationFrame(scrollFrame); scrollFrame = 0; }
    else if (!scrollFrame) { lastTime = performance.now(); scrollFrame = requestAnimationFrame(tick); }
  }

  const cancel = dragPointer(down, list, (event) => {
    x = event.clientX; y = event.clientY;
    if (!ghost) {
      if (Math.hypot(x - down.clientX, y - down.clientY) < THRESHOLD) return;
      measure();
      ghost = dragGhost(entry.is_dir ? entry.name : noteName(entry.path), entry.is_dir ? "folder-closed" : "file");
      ghost.classList.add("mod-tree");
      ghost.append(destination);
      document.body.append(ghost);
      row.classList.add("is-being-dragged");
      document.body.classList.add("is-grabbing");
      // Capture only after the threshold. A drag's eventual click belongs
      // to the list, so it cannot open/toggle the pressed or destination row.
      list.setPointerCapture(down.pointerId);
    }
    paint();
    scroll();
  }, (cancelled) => {
    listening.abort();
    clearTimeout(timer);
    cancelAnimationFrame(scrollFrame);
    highlight?.classList.remove("is-being-dragged-over");
    row.classList.remove("is-being-dragged");
    document.body.classList.remove("is-grabbing");
    const dragged = !!ghost;
    if (dragged) window.dispatchEvent(new CustomEvent("grove:explorer-drag", { detail: { entry, x, y, done: true, cancelled } }));
    ghost?.remove();
    ghost = null;
    if (dragged && focus?.isConnected) focus.focus({ preventScroll: true });
    if (dragged && !cancelled && target !== null) void moveFile(ws, entry.path, target).catch((err) => console.warn(`Could not move ${entry.path}`, err));
  }, false);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }, { capture: true, signal: listening.signal });
  return cancel;
}
