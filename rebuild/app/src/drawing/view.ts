// Read-only drawing tab. A gesture writes the world transform and, when the
// drawing has a grid, that grid's background size and position. Element markup
// stays put until the file or the theme changes.

import { api } from "../api";
import { dragPointer, h, keyButton } from "../shell/dom";
import { icon } from "../shell/icons";
import type { Tab } from "../tabs";
import type { Workspace } from "../workspace";
import { openDrawingImages, renderDrawing, type DrawingPicture } from "./render";
import { parseScene, type Scene } from "./scene";

interface Viewport { path: string; cx: number; cy: number; scale: number }
const viewports = new WeakMap<Tab, Viewport>();
let prefixes = 0;
const MIN_SCALE = 1 / 64;
const MAX_SCALE = 16;
const HEAVY_TEXT = 80_000;
const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export function createDrawingView(ws: Workspace, path: string, tab: Tab) {
  const prefix = `dw${++prefixes}`;
  const world = h("div", { class: "drawing-world" });
  const message = h("div", { class: "drawing-message" });
  message.hidden = true;
  const controls = h("div", { class: "drawing-controls" });
  const zoom = h("div", { class: "drawing-control-group" });
  const el = h("div", { class: "view-content drawing-view", tabindex: "0", "aria-label": "Drawing" }, world, message, controls);
  controls.append(zoom);

  let viewW = 0, viewH = 0, gridStep = 0;
  let state = viewports.get(tab);
  if (state && state.path !== path) state = undefined;
  let viewBox: DrawingPicture["viewBox"] | null = null;
  let emptyScene = false;
  let images: ReturnType<typeof openDrawingImages> | null = null;
  let textSeen = "";
  let darkSeen = false;
  let loadGen = 0;
  let chunkGen = 0;
  let parseTimer = 0;
  let chunkTimer = 0;
  let space = false;
  let cancelDrag: (() => void) | undefined;
  const theme = new MutationObserver(() => {
    const dark = document.documentElement.classList.contains("theme-dark");
    if (dark === darkSeen || !textSeen) return;
    darkSeen = dark;
    chunkGen++;
    clearTimeout(parseTimer);
    parseTimer = window.setTimeout(() => mount(textSeen, dark), 0);
  });

  function draw() {
    if (!state || !viewW || !viewH) return;
    const x = viewW / 2 - state.cx * state.scale;
    const y = viewH / 2 - state.cy * state.scale;
    world.style.transform = `translate(${x}px, ${y}px) scale(${state.scale})`;
    viewports.set(tab, state);
    if (!gridStep) return;
    let grid = gridStep * state.scale;
    while (grid < 10) grid *= 2;
    el.style.backgroundSize = `${grid}px ${grid}px`;
    el.style.backgroundPosition = `${x}px ${y}px`;
  }

  function fit() {
    if (!viewBox) return;
    if (!viewW || !viewH) { viewW = el.clientWidth; viewH = el.clientHeight; }
    if (!viewW || !viewH) return;
    const scale = emptyScene ? 1 : clampScale(Math.min(viewW / viewBox.width, viewH / viewBox.height));
    state = { path, cx: viewBox.width / 2, cy: viewBox.height / 2, scale };
    draw();
  }

  function zoomAt(next: number, px: number, py: number) {
    if (!state) return;
    next = clampScale(next);
    state = {
      path,
      cx: state.cx + (px - viewW / 2) * (1 / state.scale - 1 / next),
      cy: state.cy + (py - viewH / 2) * (1 / state.scale - 1 / next),
      scale: next,
    };
    draw();
  }

  function fail(text: string) {
    chunkGen++;
    world.replaceChildren();
    message.hidden = false;
    message.textContent = text;
    images?.revoke();
    images = null;
  }

  function applyChrome(picture: DrawingPicture) {
    el.style.backgroundColor = picture.background;
    gridStep = picture.grid ?? 0;
    el.style.backgroundImage = gridStep
      ? "radial-gradient(circle at .7px .7px, var(--background-modifier-border) .7px, transparent .7px)"
      : "";
    if (!gridStep) { el.style.backgroundSize = ""; el.style.backgroundPosition = ""; }
  }

  function appendChunk(svg: SVGSVGElement, chunk: string) {
    const holder = document.createElement("div");
    holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${chunk}</svg>`;
    const parsed = holder.querySelector("svg");
    if (!parsed) return;
    while (parsed.firstChild) svg.appendChild(parsed.firstChild);
  }

  function mount(text: string, dark: boolean) {
    const parsed = parseScene(text);
    if (!parsed.ok) { fail(parsed.error); return; }
    paint(parsed.scene, dark);
  }

  function paint(scene: Scene, dark: boolean) {
    message.hidden = true;
    images?.revoke();
    images = openDrawingImages(scene);
    const heavy = scene.elements.length > 400;
    const picture = renderDrawing(scene, { dark, images: images.href, idPrefix: prefix, paper: false, omitMarkup: heavy });
    viewBox = picture.viewBox;
    emptyScene = !scene.elements.some((el) => !el.isDeleted);
    applyChrome(picture);
    chunkGen++;
    clearTimeout(chunkTimer);
    if (!heavy) world.innerHTML = picture.markup;
    else {
      world.innerHTML = picture.shell;
      const svg = world.querySelector("svg");
      const mine = chunkGen;
      let index = 0;
      const step = () => {
        if (mine !== chunkGen || !svg) return;
        const chunk = picture.chunks[index++];
        if (!chunk) return;
        appendChunk(svg, chunk);
        if (index < picture.chunks.length) chunkTimer = window.setTimeout(step, 0);
      };
      if (svg && picture.chunks.length) chunkTimer = window.setTimeout(step, 0);
    }
    if (!state) fit();
    else draw();
  }

  function load() {
    const gen = ++loadGen;
    chunkGen++;
    clearTimeout(parseTimer);
    clearTimeout(chunkTimer);
    void api.readNote(path).then((text) => {
      if (gen !== loadGen) return;
      const dark = document.documentElement.classList.contains("theme-dark");
      if (text === textSeen && dark === darkSeen && world.querySelector("svg")) return;
      textSeen = text;
      darkSeen = dark;
      parseTimer = window.setTimeout(() => {
        if (gen !== loadGen) return;
        if (text.length > HEAVY_TEXT) {
          const parsed = parseScene(text);
          if (!parsed.ok) { fail(parsed.error); return; }
          parseTimer = window.setTimeout(() => { if (gen === loadGen) paint(parsed.scene, dark); }, 0);
          return;
        }
        mount(text, dark);
      }, 0);
    }, () => { if (gen === loadGen) fail("This drawing couldn’t be read."); });
  }

  for (const [label, glyph, action] of [
    ["Zoom in", "plus", () => zoomAt((state?.scale ?? 1) * Math.SQRT2, viewW / 2, viewH / 2)],
    ["Zoom out", "minus", () => zoomAt((state?.scale ?? 1) / Math.SQRT2, viewW / 2, viewH / 2)],
    ["Reset zoom", "rotate-cw", () => zoomAt(1, viewW / 2, viewH / 2)],
    ["Zoom to fit", "maximize", () => fit()],
  ] as const) {
    zoom.append(keyButton(icon(glyph), label, (event) => {
      if (event.type === "keydown") event.stopPropagation();
      action();
      el.focus({ preventScroll: true });
    }));
  }

  const resize = new ResizeObserver(([entry]) => {
    viewW = entry.contentRect.width;
    viewH = entry.contentRect.height;
    if (viewBox && !state) fit();
    else if (state) draw();
  });
  resize.observe(el);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  const unwatch = ws.vault.onModified((changed) => { if (changed === path) load(); });

  el.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (!state || (event.target as Element).closest(".drawing-controls")) return;
    const rect = el.getBoundingClientRect();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewH : 1;
    if (event.ctrlKey || space) zoomAt(state.scale * 2 ** (-event.deltaY * unit / 300), event.clientX - rect.left, event.clientY - rect.top);
    else {
      state = {
        path,
        cx: state.cx + (event.deltaX + (event.shiftKey ? event.deltaY : 0)) * unit * 0.93 / state.scale,
        cy: state.cy + (event.shiftKey ? 0 : event.deltaY * unit * 0.93 / state.scale),
        scale: state.scale,
      };
      draw();
    }
  }, { passive: false });
  el.addEventListener("keydown", (event) => {
    if ((event.target as Element).closest(".drawing-controls")) return;
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      space = true;
      el.classList.add("is-grabbable");
    }
  });
  const releaseSpace = () => { space = false; el.classList.remove("is-grabbable"); };
  el.addEventListener("keyup", (event) => { if (event.code === "Space" || event.key === " ") releaseSpace(); });
  el.addEventListener("focusout", (event) => { if (!el.contains(event.relatedTarget as Node | null)) releaseSpace(); });
  el.addEventListener("pointerdown", (event) => {
    if ((event.target as Element).closest(".drawing-controls")) return;
    if (!state || (event.button !== 1 && !(event.button === 0 && space))) return;
    event.preventDefault();
    event.stopPropagation();
    cancelDrag?.();
    el.classList.add("is-panning");
    const start = state;
    const originX = event.clientX, originY = event.clientY;
    cancelDrag = dragPointer(event, el, (move) => {
      state = { path, scale: start.scale, cx: start.cx - (move.clientX - originX) / start.scale, cy: start.cy - (move.clientY - originY) / start.scale };
      draw();
    }, () => { el.classList.remove("is-panning"); cancelDrag = undefined; });
  }, true);
  el.addEventListener("auxclick", (event) => { if (event.button === 1) event.preventDefault(); });

  load();
  return {
    el,
    dispose() {
      loadGen++;
      chunkGen++;
      clearTimeout(parseTimer);
      clearTimeout(chunkTimer);
      cancelDrag?.();
      resize.disconnect();
      theme.disconnect();
      unwatch();
      images?.revoke();
      el.remove();
    },
  };
}
