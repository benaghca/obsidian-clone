import { dragPointer, h, keyButton } from "../shell/dom";
import { icon } from "../shell/icons";
import { canvasHelp, canvasReadOnly, canvasSettings } from "./controls";
import type { CanvasNode } from "./model";
import { glideCamera, type Camera } from "./present";
import type { Tab } from "../tabs";
import { canvasViewports } from "./viewports";
import { clampZoom, glideAt, glideMs, retarget, zoomAround, type Glide } from "./zoomGlide";

interface Bounds { left: number; top: number; right: number; bottom: number }
export { canvasViewports };
const clamp = clampZoom;

// One immutable band sheet. The view applies attributes to rings, titles and
// handles in bounded slices, so settling never invalidates the world's subtree.
// A gesture still writes only the navigation transform, grid and selection menu.
const BANDS = { min: -16, max: 4 };
export const zoomBand = (scale: number) => Math.max(BANDS.min, Math.min(BANDS.max, Math.round(Math.log2(scale) * 4)));
// Title mode starts below 45% and ends above 55%, so a wobble at the threshold never
// flickers. Its highest band is -3 (55%); a card's title band of -2 means "never".
// A ctrl-wheel delta arrives as float32, so a zoom aimed at either edge lands a few
// billionths off. Snap that onto the edge; one notch is about 0.2%.
const TITLE_EPS = 1e-6;
const titleEdge = (scale: number) => Math.abs(scale - .45) <= TITLE_EPS ? .45 : Math.abs(scale - .55) <= TITLE_EPS ? .55 : scale;
const titleMode = (scale: number, now: boolean) => { const zoom = titleEdge(scale); return now ? zoom <= .55 : zoom < .45; };
const TITLE_MAX = -2;
// The band below which a card is under 26px tall or 50px wide on screen: its title
// is hidden and it shows as a box. Undefined when the title always fits.
export function titleBand(width: number, height: number) {
  const band = Math.ceil(Math.log2(Math.max(26 / height, 50 / width)) * 4);
  return band > BANDS.min ? Math.min(band, TITLE_MAX) : undefined;
}
let bandSheet: CSSStyleSheet | undefined;
function installBands() {
  if (bandSheet) return;
  bandSheet = new CSSStyleSheet();
  const rules = [];
  for (let band = BANDS.min; band <= BANDS.max; band++)
    rules.push(`.canvas-band[data-canvas-band="${band}"] { --canvas-inverse-scale: ${2 ** (-band / 4)}; }`);
  bandSheet.replaceSync(rules.join("\n"));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, bandSheet];
}
// How long the wheel must rest before zoom-dependent sizes follow.
const SETTLE_MS = 120;

export interface CanvasViewport { x: number; y: number; width: number; height: number; focusX: number; focusY: number; band: number; titles: boolean; scale: number }
export function canvasNavigation(el: HTMLElement, world: HTMLElement, tab: Tab, path: string, history: (forward: boolean) => void, refresh: () => void, onPresent?: () => void) {
  let state = canvasViewports.get(tab);
  if (state?.path !== path) state = undefined;
  let bounds: Bounds | null = null, width = 0, height = 0, frame = 0, drawn = "", settle = 0, gesture = false, flushBand = false, wheelPan = false;
  let rect: DOMRect | undefined, menu: HTMLElement | undefined, styled: HTMLElement | undefined;
  let space = false, dragging = false, suppressClick = false, titles = false;
  let held = false, gliding = false, glideGen = 0, glideResize = false;
  // The wheel and pinch glide (zoomGlide.ts): its segment, the screen point it zooms
  // around, and when the last zoom input arrived.
  let zoomGlide: Glide | undefined, zoomFrame = 0, anchorX = 0, anchorY = 0, lastZoomInput = 0, pinching = false, pinchFrom = 1;
  // While the board moves it is one composited layer, so a frame only changes its
  // transform. At rest nothing on the board is a layer: an engine that rasters a layer
  // once and scales the bitmap (WebKitGTK does) would otherwise blur text zoomed in.
  let moving = false, rest = 0;
  let heldResize = () => {};
  let cancelDrag: (() => void) | undefined;
  const events = new AbortController();
  let changed = () => {}, pause = () => {}, focusX = .5, focusY = .5;
  let notify = 0;
  const snapshot = (): CanvasViewport | undefined => state && width && height ? { x: state.cx - width / state.scale / 2, y: state.cy - height / state.scale / 2, width: width / state.scale, height: height / state.scale, focusX: state.cx + (focusX - .5) * width / state.scale, focusY: state.cy + (focusY - .5) * height / state.scale, band: zoomBand(state.scale), titles, scale: state.scale } : undefined;
  const notifyLater = () => { clearTimeout(notify); notify = window.setTimeout(() => { notify = 0; if (!settle) changed(); }, SETTLE_MS); };
  installBands();
  const still = () => { clearTimeout(rest); rest = 0; if (moving) { moving = false; world.classList.remove("is-moving"); } };
  const move = () => {
    if (!moving) { moving = true; world.classList.add("is-moving"); }
    clearTimeout(rest); rest = window.setTimeout(still, SETTLE_MS);
  };
  // Title mode changes with the band, at settle: one class on the world.
  const applyBand = (scale: number) => {
    clearTimeout(settle); settle = 0; clearTimeout(notify); notify = 0;
    still();
    world.dataset.zoomBand = String(zoomBand(scale));
    titles = titleMode(scale, titles); world.classList.toggle("is-zoomed-out", titles);
    changed();
  };
  const postponeBand = () => { clearTimeout(settle); settle = window.setTimeout(() => { settle = 0; if (state) applyBand(state.scale); }, SETTLE_MS); };
  // Wheel and pinch wait out the 120ms settle, including wheels that no longer
  // change the scale (the zoom cap). Buttons, fit, zoom-to-selection, resize and
  // the first draw apply the band now. A pan does neither, so that frame stays a
  // transform change while the zoom's timer is still running.
  function syncBand(scale: number, wheel: boolean, flush: boolean, first: boolean) {
    if (world.dataset.zoomBand === String(zoomBand(scale)) && titles === titleMode(scale, titles)) { if (flush) applyBand(scale); else if (wheel) { clearTimeout(settle); settle = 0; } return; }
    if (wheel && !flush) postponeBand();
    else if (flush || first) applyBand(scale);
  }
  // The selection menu is appended to the world after the cards; look from the end,
  // and only after the world's children change, not on every frame of a glide.
  let menuKnown = false;
  const worldChildren = new MutationObserver(() => { menuKnown = false; });
  worldChildren.observe(world, { childList: true });
  function selectionMenu() {
    if (menu?.parentElement === world) return menu;
    if (worldChildren.takeRecords().length) menuKnown = false;
    if (menuKnown) return menu = undefined;
    menuKnown = true;
    for (let child = world.lastElementChild; child; child = child.previousElementSibling)
      if (child.classList.contains("canvas-selection-menu")) return menu = child as HTMLElement;
    return menu = undefined;
  }
  function placeTransform(cx: number, cy: number, scale: number) {
    const x = width / 2 - cx * scale, y = height / 2 - cy * scale;
    world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }
  function draw() {
    cancelAnimationFrame(frame);
    frame = 0;
    const wheel = gesture, flush = flushBand, pan = wheelPan;
    gesture = false; flushBand = false; wheelPan = false;
    if (!state || !width || !height) return;
    const { cx, cy, scale } = state;
    const x = width / 2 - cx * scale, y = height / 2 - cy * scale;
    canvasViewports.set(tab, state);
    // A clamped wheel redraws the same viewport; it still has to postpone settle.
    syncBand(scale, wheel, flush, drawn === "");
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
    if (wheel || dragging) { pause(); notifyLater(); move(); }
    else if (!flush) { notifyLater(); if (pan) move(); }
    placeTransform(cx, cy, scale);
    // Obsidian keeps dots legible when zoomed out, with a fixed .7px radius.
    let grid = 20 * scale;
    while (grid < 10) grid *= 2;
    el.style.backgroundSize = `${grid}px ${grid}px`;
    el.style.backgroundPosition = `${x}px ${y}px`;
  }
  const schedule = () => { frame ||= requestAnimationFrame(draw); };
  function fit(next = bounds, max = 1) {
    if (held || !next || !width || !height) return;
    stopGlide();
    gesture = false; flushBand = true;
    state = { path, cx: (next.left + next.right) / 2, cy: (next.top + next.bottom) / 2,
      scale: clamp(Math.min(max, width / (Math.max(1, next.right - next.left) * 1.1), height / (Math.max(1, next.bottom - next.top) * 1.1))) };
    draw();
  }
  function zoom(scale: number, x = width / 2, y = height / 2) {
    if (!state || held) return;
    Object.assign(state, zoomAround(state, clamp(scale), x, y, width, height));
    schedule();
  }
  // Where the board is headed: a button press or a tick builds on the glide's target.
  const aim = () => zoomGlide?.target ?? state?.scale ?? 1;
  const stopGlide = () => { cancelAnimationFrame(zoomFrame); zoomFrame = 0; zoomGlide = undefined; };
  // Land a running glide where it was headed (a resize keeps the zoom that was asked for).
  const finishGlide = () => {
    const target = zoomGlide?.target; stopGlide();
    if (state && target !== undefined) Object.assign(state, zoomAround(state, target, anchorX, anchorY, width, height));
  };
  // A wheel tick or pinch step of `step` octaves around (x, y): move the target and glide.
  function zoomBy(step: number, x: number, y: number) {
    if (!state || held) return;
    gesture = true; flushBand = false;
    const now = performance.now();
    lastZoomInput = now;
    // A zero step (Ctrl with a sideways scroll, or a redraw after the viewport was set) only redraws.
    if (step === 0) { schedule(); return; }
    anchorX = x; anchorY = y;
    zoomGlide = retarget(zoomGlide, state.scale, clamp(aim() * 2 ** step), now, glideMs(step));
    // At the zoom limit: the same viewport is redrawn, which still postpones settle.
    if (!zoomGlide) { schedule(); return; }
    zoomFrame ||= requestAnimationFrame(glideFrame);
  }
  function glideFrame() {
    zoomFrame = 0;
    if (!zoomGlide || !state || held) { zoomGlide = undefined; return; }
    const now = performance.now(), at = glideAt(zoomGlide, now), target = zoomGlide.target;
    if (at.done) zoomGlide = undefined; else zoomFrame = requestAnimationFrame(glideFrame);
    Object.assign(state, zoomAround(state, at.done ? target : clamp(2 ** at.log), anchorX, anchorY, width, height));
    gesture = true; flushBand = false;
    draw();
    if (at.done) settleAfter(now);
  }
  // A glide has landed. Settle now if the input has rested for the settle time, else when it has.
  function settleAfter(now: number) {
    if (!state) return;
    const wait = lastZoomInput + SETTLE_MS - now;
    if (wait <= 0) applyBand(state.scale);
    else { clearTimeout(settle); settle = window.setTimeout(() => { settle = 0; if (state) applyBand(state.scale); }, wait); }
  }
  // Pressing on the board stops a running glide where it was last painted: the
  // browser has hit-tested the press against that board, and a pan, card drag or
  // double-click works from it. state is the painted camera (glideFrame draws as it
  // sets it), so nothing moves.
  function haltGlide() {
    if (!zoomGlide || !state) return;
    stopGlide();
    settleAfter(performance.now());
  }
  const zoomNow = (scale: number) => { if (held || !state) return; stopGlide(); gesture = false; flushBand = true; zoom(scale); };
  const controls = h("div", { class: "canvas-controls" });
  const settingsButton = keyButton(icon("settings"), "Canvas settings", () => canvasSettings(el, settingsButton, refresh));
  const undo = keyButton(icon("undo-2"), "Undo", () => history(false));
  const redo = keyButton(icon("redo-2"), "Redo", () => history(true));
  const zoomControls = h("div", { class: "canvas-control-group" });
  for (const [label, glyph, action] of [
    ["Zoom in", "plus", () => zoomNow(aim() * Math.SQRT2)],
    ["Reset zoom", "rotate-cw", () => zoomNow(1)],
    ["Zoom to fit\n(Shift + 1)", "maximize", () => fit()],
    ["Zoom out", "minus", () => zoomNow(aim() / Math.SQRT2)],
  ] as const) zoomControls.append(keyButton(icon(glyph), label, e => {
    if (e.type === "keydown") { e.stopPropagation(); action(); }
    else { action(); el.focus({ preventScroll: true }); }
  }));
  const presentButton = keyButton(icon("play"), "Start presentation\n(F5)", e => {
    if (e.type === "keydown") e.stopPropagation();
    onPresent?.();
    el.focus({ preventScroll: true });
  });
  controls.append(h("div", { class: "canvas-control-group" }, presentButton),
    h("div", { class: "canvas-control-group" }, settingsButton), zoomControls,
    h("div", { class: "canvas-control-group" }, undo, redo),
    h("div", { class: "canvas-control-group" }, keyButton(icon("circle-help"), "Canvas help", canvasHelp)));
  el.append(controls);
  el.addEventListener("wheel", e => {
    if (!e.ctrlKey && (e.target as Element).closest(".canvas-node.is-editing")) return;
    if (!e.ctrlKey) {
      const scrolling = (e.target as Element).closest<HTMLElement>(".canvas-node.is-base .bases-scroll, .canvas-node.is-base .bases-kanban, .canvas-node.is-base .bases-kanban-body");
      if (scrolling && (scrolling.scrollHeight > scrolling.clientHeight + 1 || scrolling.scrollWidth > scrolling.clientWidth + 1)) return;
    }
    if (held) {
      const content = (e.target as Element).closest<HTMLElement>(".canvas-node-content");
      if (!(content && content.scrollHeight > content.clientHeight + 1)) e.preventDefault();
      return;
    }
    e.preventDefault();
    if (!state || (e.target as Element).closest(".canvas-controls, .canvas-card-menu, .canvas-selection-menu, .canvas-present-ui")) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1;
    // Canvas help: "press Space or Ctrl … and scroll" to zoom.
    pause(); notifyLater();
    rect ??= el.getBoundingClientRect();
    focusX = (e.clientX - rect.left) / width; focusY = (e.clientY - rect.top) / height;
    if (e.ctrlKey || space) {
      // WebKit on macOS reports a pinch as gesture events too; those drive it then.
      if (!pinching) zoomBy(-e.deltaY * unit / 300, e.clientX - rect.left, e.clientY - rect.top);
    } else {
      state.cx += (e.deltaX + (e.shiftKey ? e.deltaY : 0)) * unit * .93 / state.scale;
      if (!e.shiftKey) state.cy += e.deltaY * unit * .93 / state.scale;
      wheelPan = true;
      schedule();
    }
  }, { passive: false });
  // Safari-style gesture events carry the pinch's scale since it began.
  type Pinch = Event & { scale: number; clientX: number; clientY: number };
  el.addEventListener("gesturestart", e => {
    if (!state || held) return;
    e.preventDefault(); pinching = true; pinchFrom = aim();
  });
  el.addEventListener("gesturechange", e => {
    const pinch = e as Pinch;
    if (!pinching || !state || held || !(pinch.scale > 0)) return;
    e.preventDefault();
    rect ??= el.getBoundingClientRect();
    const x = Number.isFinite(pinch.clientX) ? pinch.clientX - rect.left : width / 2, y = Number.isFinite(pinch.clientY) ? pinch.clientY - rect.top : height / 2;
    const step = Math.log2(clamp(pinchFrom * pinch.scale) / aim());
    if (step) zoomBy(step, x, y);
  });
  el.addEventListener("gestureend", e => { if (pinching) { e.preventDefault(); pinching = false; } });
  el.addEventListener("keydown", e => {
    if ((e.target as Element).closest("input, textarea, [contenteditable=true], [contenteditable=plaintext-only], .cm-editor, .canvas-node.is-base .bases-view, .canvas-controls, .canvas-card-menu, .canvas-selection-menu")) return;
    if (held) return;
    if (e.code === "Space" || e.key === " ") { e.preventDefault(); space = true; el.classList.add("is-grabbable"); }
    if (e.shiftKey && e.code === "Digit1") { e.preventDefault(); fit(); }
  });
  const releaseSpace = () => { space = false; el.classList.remove("is-grabbable"); };
  el.addEventListener("keyup", e => { if (e.code === "Space" || e.key === " ") releaseSpace(); });
  el.addEventListener("focusout", e => { if (!el.contains(e.relatedTarget as Node | null)) releaseSpace(); });
  window.addEventListener("blur", releaseSpace, { signal: events.signal });
  el.addEventListener("pointerdown", e => {
    suppressClick = false;
    const target = e.target as Element;
    if (target.closest(".canvas-controls, .canvas-card-menu, .canvas-selection-menu")) return;
    // Focusing the board on a button's press swallows its click. Space-pan still
    // starts below, including on a link, so a held Space click does not follow it.
    if (!target.closest(".cm-editor, [contenteditable], input, textarea, button, a")) el.focus({ preventScroll: true });
    if (held) return;
    haltGlide();
    if (!state || (e.button !== 1 && !(e.button === 0 && space))) return;
    e.preventDefault(); e.stopPropagation();
    cancelDrag?.();
    dragging = suppressClick = true;
    el.classList.add("is-panning");
    const dragRect = rect ??= el.getBoundingClientRect();
    const start = { ...state };
    cancelDrag = dragPointer(e, el, move => {
      focusX = (move.clientX - dragRect.left) / width; focusY = (move.clientY - dragRect.top) / height;
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
    if (gliding) { glideResize = true; return; }
    if (held) { heldResize(); return; }
    finishGlide();
    gesture = false; flushBand = true;
    if (!state) fit(); else draw();
  });
  size.observe(el);
  // The wheel reads the board's position from this cache, not from layout per event.
  el.addEventListener("pointerenter", () => { rect = undefined; });
  return {
    snapshot,
    watch(onChange: () => void, onPause: () => void) { changed = onChange; pause = onPause; },
    zoomTo(nodes: Pick<CanvasNode, "x" | "y" | "width" | "height">[]) { if (nodes.length) fit({ left: Math.min(...nodes.map(n => n.x)), top: Math.min(...nodes.map(n => n.y)), right: Math.max(...nodes.map(n => n.x + n.width)), bottom: Math.max(...nodes.map(n => n.y + n.height)) }, 2); },
    updateHistory(back: boolean, forward: boolean) {
      for (const [button, enabled] of [[undo, back], [redo, forward]] as const) {
        const disabled = !enabled || canvasReadOnly.has(el);
        button.classList.toggle("is-disabled", disabled); button.setAttribute("aria-disabled", String(disabled)); button.tabIndex = disabled ? -1 : 0;
      }
    },
    loaded(next: Bounds) { bounds = next; if (!state) fit(); else draw(); },
    camera() { return state && width && height ? { cx: state.cx, cy: state.cy, scale: state.scale, width, height } : undefined; },
    reflow() { width = el.clientWidth; height = el.clientHeight; rect = undefined; },
    jump(next: Camera) {
      stopGlide();
      glideGen++; gliding = false; glideResize = false; cancelAnimationFrame(frame); frame = 0;
      state = { path, cx: next.cx, cy: next.cy, scale: next.scale };
      canvasViewports.set(tab, state);
      if (!width || !height) return;
      gesture = false; flushBand = true;
      drawn = "";
      draw();
    },
    glide(next: Camera, ms: number) {
      stopGlide();
      const gen = ++glideGen;
      gliding = true;
      glideResize = false;
      cancelAnimationFrame(frame); frame = 0;
      clearTimeout(notify); notify = 0;
      clearTimeout(settle); settle = 0;
      pause();
      return new Promise<void>(resolve => {
        if (!state || !width || !height) { gliding = false; resolve(); return; }
        const from = { cx: state.cx, cy: state.cy, scale: state.scale };
        const t0 = performance.now();
        const step = (now: number) => {
          if (gen !== glideGen) { resolve(); return; }
          const p = Math.min(1, (now - t0) / Math.max(1, ms));
          const cam = glideCamera(from, next, p);
          state = { path, ...cam };
          placeTransform(cam.cx, cam.cy, cam.scale); move();
          canvasViewports.set(tab, state);
          if (p < 1) requestAnimationFrame(step);
          else {
            gliding = false; drawn = ""; gesture = false; flushBand = true;
            const refit = glideResize && held;
            glideResize = false;
            if (refit) heldResize();
            else draw();
            resolve();
          }
        };
        requestAnimationFrame(step);
      });
    },
    cancelGlide() { glideGen++; gliding = false; glideResize = false; },
    hold(next: boolean) { held = next; if (next) { releaseSpace(); stopGlide(); pinching = false; } },
    onHeldResize(fn: () => void) { heldResize = fn; },
    dispose() { glideGen++; gliding = false; glideResize = false; stopGlide(); cancelDrag?.(); cancelAnimationFrame(frame); clearTimeout(settle); clearTimeout(notify); clearTimeout(rest); size.disconnect(); worldChildren.disconnect(); events.abort(); },
  };
}
