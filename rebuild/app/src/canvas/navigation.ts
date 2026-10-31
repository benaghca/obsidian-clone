import { dragPointer, h, keyButton } from "../shell/dom";
import { icon } from "../shell/icons";
import { canvasHelp, canvasReadOnly, canvasSettings } from "./controls";
import type { CanvasNode } from "./model";
import type { Tab } from "../tabs";

interface Bounds { left: number; top: number; right: number; bottom: number }
interface Viewport { path: string; cx: number; cy: number; scale: number }
// Only live tabs retain a viewport. This is never part of saved layout/JSON.
export const canvasViewports = new WeakMap<Tab, Viewport>();
const clamp = (scale: number) => Math.max(1 / 16, Math.min(2, scale));

// Zoom bands: quarter octaves from 1/16x to 2x. Handles and edge hit areas keep their
// screen size through one band rule each, chosen by an attribute on the world when a
// zoom settles. One static sheet for every canvas: a pan or zoom frame writes no
// stylesheet, since a stylesheet change restyles the page (all of it in WebKit).
// A selector list, not :is(), which matched about 1.6x slower per band change.
const BANDS = { min: -16, max: 4 };
export const zoomBand = (scale: number) => Math.max(BANDS.min, Math.min(BANDS.max, Math.round(Math.log2(scale) * 4)));
let bandSheet: CSSStyleSheet | undefined;
function installBands() {
  if (bandSheet) return;
  bandSheet = new CSSStyleSheet();
  const rules = [];
  for (let band = BANDS.min; band <= BANDS.max; band++)
    rules.push(`${[" > .canvas-node > .canvas-node-connection-point", " > .canvas-edge-end", " .canvas-edge-hit"].map(handle => `.canvas-world[data-zoom-band="${band}"]${handle}`).join(", ")} { --canvas-inverse-scale: ${2 ** (-band / 4)}; }`);
  bandSheet.replaceSync(rules.join("\n"));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, bandSheet];
}
// How long the wheel must rest before zoom-dependent sizes follow.
const SETTLE_MS = 120;

export function canvasNavigation(el: HTMLElement, world: HTMLElement, tab: Tab, path: string, history: (forward: boolean) => void, refresh: () => void) {
  let state = canvasViewports.get(tab);
  if (state?.path !== path) state = undefined;
  let bounds: Bounds | null = null, width = 0, height = 0, frame = 0, drawn = "", settle = 0, gesture = false;
  let rect: DOMRect | undefined, menu: HTMLElement | undefined, styled: HTMLElement | undefined;
  let space = false, dragging = false, suppressClick = false;
  let cancelDrag: (() => void) | undefined;
  const events = new AbortController();
  installBands();
  const band = (scale: number) => { clearTimeout(settle); settle = 0; world.dataset.zoomBand = String(zoomBand(scale)); };
  // The selection menu is appended to the world after the cards; look from the end.
  function selectionMenu() {
    if (menu?.parentElement === world) return menu;
    for (let child = world.lastElementChild; child; child = child.previousElementSibling)
      if (child.classList.contains("canvas-selection-menu")) return menu = child as HTMLElement;
    return menu = undefined;
  }
  function draw() {
    cancelAnimationFrame(frame);
    frame = 0;
    const wheel = gesture;
    gesture = false;
    if (!state || !width || !height) return;
    const { cx, cy, scale } = state;
    const x = width / 2 - cx * scale, y = height / 2 - cy * scale;
    canvasViewports.set(tab, state);
    // A card drag redraws with the same viewport on every move; a redrawn board
    // brings a new selection menu.
    const key = `${x} ${y} ${scale} ${width} ${height}`, toolbar = selectionMenu();
    if (key === drawn && toolbar === styled) return;
    // Only the selection menu tracks every frame: its own inline variables, so no
    // other element is restyled while panning or zooming.
    if (toolbar) {
      toolbar.style.setProperty("--canvas-inverse-scale", String(1 / scale));
      for (const [side, value] of [["left", (10 - x) / scale], ["right", (width - 10 - x) / scale], ["top", (10 - y) / scale], ["bottom", (height - 10 - y) / scale]] as const)
        toolbar.style.setProperty(`--canvas-view-${side}`, `${value}px`);
    }
    styled = toolbar;
    if (key === drawn) return;
    drawn = key;
    if (world.dataset.zoomBand !== String(zoomBand(scale))) {
      if (!wheel) band(scale);
      else { clearTimeout(settle); settle = window.setTimeout(() => band(state!.scale), SETTLE_MS); }
    }
    world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    // Obsidian keeps dots legible when zoomed out, with a fixed .7px radius.
    let grid = 20 * scale;
    while (grid < 10) grid *= 2;
    el.style.backgroundSize = `${grid}px ${grid}px`;
    el.style.backgroundPosition = `${x}px ${y}px`;
  }
  const schedule = () => { frame ||= requestAnimationFrame(draw); };
  function fit(next = bounds, max = 1) {
    if (!next || !width || !height) return;
    state = { path, cx: (next.left + next.right) / 2, cy: (next.top + next.bottom) / 2,
      scale: clamp(Math.min(max, width / (Math.max(1, next.right - next.left) * 1.1), height / (Math.max(1, next.bottom - next.top) * 1.1))) };
    draw();
  }
  function zoom(scale: number, x = width / 2, y = height / 2) {
    if (!state) return;
    scale = clamp(scale);
    state.cx += (x - width / 2) * (1 / state.scale - 1 / scale);
    state.cy += (y - height / 2) * (1 / state.scale - 1 / scale);
    state.scale = scale;
    schedule();
  }
  const controls = h("div", { class: "canvas-controls" });
  const settingsButton = keyButton(icon("settings"), "Canvas settings", () => canvasSettings(el, settingsButton, refresh));
  const undo = keyButton(icon("undo-2"), "Undo", () => history(false));
  const redo = keyButton(icon("redo-2"), "Redo", () => history(true));
  const zoomControls = h("div", { class: "canvas-control-group" });
  for (const [label, glyph, action] of [
    ["Zoom in", "plus", () => zoom((state?.scale ?? 1) * Math.SQRT2)],
    ["Reset zoom", "rotate-cw", () => zoom(1)],
    ["Zoom to fit\n(Shift + 1)", "maximize", () => fit()],
    ["Zoom out", "minus", () => zoom((state?.scale ?? 1) / Math.SQRT2)],
  ] as const) zoomControls.append(keyButton(icon(glyph), label, e => {
    if (e.type === "keydown") { e.stopPropagation(); action(); }
    else { action(); el.focus({ preventScroll: true }); }
  }));
  controls.append(h("div", { class: "canvas-control-group" }, settingsButton), zoomControls,
    h("div", { class: "canvas-control-group" }, undo, redo),
    h("div", { class: "canvas-control-group" }, keyButton(icon("circle-help"), "Canvas help", canvasHelp)));
  el.append(controls);
  el.addEventListener("wheel", e => {
    if (!e.ctrlKey && (e.target as Element).closest(".canvas-node.is-editing")) return;
    e.preventDefault();
    if (!state || (e.target as Element).closest(".canvas-controls, .canvas-card-menu, .canvas-selection-menu")) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
    // Canvas help: "press Space or Ctrl … and scroll" to zoom.
    if (e.ctrlKey || space) {
      rect ??= el.getBoundingClientRect();
      gesture = true;
      zoom(state.scale * 2 ** (-e.deltaY * unit / 300), e.clientX - rect.left, e.clientY - rect.top);
    } else {
      state.cx += (e.deltaX + (e.shiftKey ? e.deltaY : 0)) * unit * .93 / state.scale;
      if (!e.shiftKey) state.cy += e.deltaY * unit * .93 / state.scale;
      schedule();
    }
  }, { passive: false });
  el.addEventListener("keydown", e => {
    if ((e.target as Element).closest("input, textarea, [contenteditable=true], [contenteditable=plaintext-only], .cm-editor, .canvas-controls, .canvas-card-menu, .canvas-selection-menu")) return;
    if (e.code === "Space" || e.key === " ") { e.preventDefault(); space = true; el.classList.add("is-grabbable"); }
    if (e.shiftKey && e.code === "Digit1") { e.preventDefault(); fit(); }
  });
  const releaseSpace = () => { space = false; el.classList.remove("is-grabbable"); };
  el.addEventListener("keyup", e => { if (e.code === "Space" || e.key === " ") releaseSpace(); });
  el.addEventListener("focusout", e => { if (!el.contains(e.relatedTarget as Node | null)) releaseSpace(); });
  window.addEventListener("blur", releaseSpace, { signal: events.signal });
  el.addEventListener("pointerdown", e => {
    suppressClick = false;
    if ((e.target as Element).closest(".canvas-controls, .canvas-card-menu, .canvas-selection-menu")) return;
    if (!(e.target as Element).closest(".cm-editor, [contenteditable], input, textarea")) el.focus({ preventScroll: true });
    if (!state || (e.button !== 1 && !(e.button === 0 && space))) return;
    e.preventDefault(); e.stopPropagation();
    cancelDrag?.();
    dragging = suppressClick = true;
    el.classList.add("is-panning");
    const start = { ...state };
    cancelDrag = dragPointer(e, el, move => {
      state = { ...start, cx: start.cx - (move.clientX - e.clientX) / start.scale, cy: start.cy - (move.clientY - e.clientY) / start.scale };
      draw();
    }, () => { dragging = false; el.classList.remove("is-panning"); cancelDrag = undefined; });
  }, true);
  const blockClick = (e: MouseEvent) => { if (dragging || suppressClick || space || e.button === 1) { e.preventDefault(); e.stopImmediatePropagation(); } };
  el.addEventListener("click", blockClick, true);
  el.addEventListener("auxclick", blockClick, true);
  el.addEventListener("dblclick", blockClick, true);
  const size = new ResizeObserver(([entry]) => {
    width = entry.contentRect.width; height = entry.contentRect.height; rect = undefined;
    if (!state) fit(); else draw();
  });
  size.observe(el);
  // The wheel reads the board's position from this cache, not from layout per event.
  el.addEventListener("pointerenter", () => { rect = undefined; });
  return {
    zoomTo(nodes: Pick<CanvasNode, "x" | "y" | "width" | "height">[]) { if (nodes.length) fit({ left: Math.min(...nodes.map(n => n.x)), top: Math.min(...nodes.map(n => n.y)), right: Math.max(...nodes.map(n => n.x + n.width)), bottom: Math.max(...nodes.map(n => n.y + n.height)) }, 2); },
    updateHistory(back: boolean, forward: boolean) {
      for (const [button, enabled] of [[undo, back], [redo, forward]] as const) {
        const disabled = !enabled || canvasReadOnly.has(el);
        button.classList.toggle("is-disabled", disabled); button.setAttribute("aria-disabled", String(disabled)); button.tabIndex = disabled ? -1 : 0;
      }
    },
    loaded(next: Bounds) { bounds = next; if (!state) fit(); else draw(); },
    dispose() { cancelDrag?.(); cancelAnimationFrame(frame); clearTimeout(settle); size.disconnect(); events.abort(); },
  };
}
