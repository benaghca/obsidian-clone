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

export function canvasNavigation(el: HTMLElement, world: HTMLElement, tab: Tab, path: string, history: (forward: boolean) => void, refresh: () => void) {
  let state = canvasViewports.get(tab);
  if (state?.path !== path) state = undefined;
  let bounds: Bounds | null = null, width = 0, height = 0, frame = 0, drawn = "";
  let space = false, dragging = false, suppressClick = false;
  let cancelDrag: (() => void) | undefined;
  const events = new AbortController();
  // Size only controls; inheriting a zoom variable through every card's Markdown
  // makes zoom recalculate the whole board's styles on each frame.
  world.id = `canvas-world-${crypto.randomUUID()}`;
  const sizing = new CSSStyleSheet();
  sizing.replaceSync(`#${world.id} :is(.canvas-selection-menu, .canvas-node-connection-point, .canvas-edge-end, .canvas-edge-hit) { --canvas-inverse-scale: 1; }
    #${world.id} > .canvas-selection-menu {}`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sizing];
  const controlSize = (sizing.cssRules[0] as CSSStyleRule).style;
  const menuBounds = (sizing.cssRules[1] as CSSStyleRule).style;
  function draw() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!state || !width || !height) return;
    const { cx, cy, scale } = state;
    const x = width / 2 - cx * scale, y = height / 2 - cy * scale;
    canvasViewports.set(tab, state);
    // A card drag redraws with the same viewport on every move. Writing a rule
    // of the adopted sheet, even with the same value, restyles the whole page.
    const key = `${x} ${y} ${scale} ${width} ${height}`;
    if (key === drawn) return;
    drawn = key;
    controlSize.setProperty("--canvas-inverse-scale", String(1 / scale));
    // Only the toolbar needs viewport bounds; keep pan/zoom out of child DOM.
    for (const [side, value] of [["left", (10 - x) / scale], ["right", (width - 10 - x) / scale], ["top", (10 - y) / scale], ["bottom", (height - 10 - y) / scale]] as const)
      menuBounds.setProperty(`--canvas-view-${side}`, `${value}px`);
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
    if (e.ctrlKey) {
      const rect = el.getBoundingClientRect();
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
    width = entry.contentRect.width; height = entry.contentRect.height;
    if (!state) fit(); else draw();
  });
  size.observe(el);
  return {
    zoomTo(nodes: Pick<CanvasNode, "x" | "y" | "width" | "height">[]) { if (nodes.length) fit({ left: Math.min(...nodes.map(n => n.x)), top: Math.min(...nodes.map(n => n.y)), right: Math.max(...nodes.map(n => n.x + n.width)), bottom: Math.max(...nodes.map(n => n.y + n.height)) }, 2); },
    updateHistory(back: boolean, forward: boolean) {
      for (const [button, enabled] of [[undo, back], [redo, forward]] as const) {
        const disabled = !enabled || canvasReadOnly.has(el);
        button.classList.toggle("is-disabled", disabled); button.setAttribute("aria-disabled", String(disabled)); button.tabIndex = disabled ? -1 : 0;
      }
    },
    loaded(next: Bounds) { bounds = next; if (!state) fit(); else draw(); },
    dispose() { cancelDrag?.(); cancelAnimationFrame(frame); size.disconnect(); events.abort(); document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== sizing); },
  };
}
