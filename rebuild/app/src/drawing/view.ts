// Drawing tab. A pan or zoom writes the world transform and, when the
// drawing has a grid, that grid's background size and position. The SVG sits
// in scene coordinates (placed at its viewBox corner, overflow visible), so
// an edit that grows the drawing needs no new viewBox. Opening or a theme
// change paints the whole drawing; an edit repaints only the elements it
// touched. Edits save through write_note after a short pause, like a canvas.

import { api } from "../api";
import { dragPointer, h, keyButton } from "../shell/dom";
import { icon } from "../shell/icons";
import type { Tab } from "../tabs";
import type { Workspace } from "../workspace";
import { drawingEditor } from "./editor";
import { openDrawingImages, renderDrawing, type DrawingPicture } from "./render";
import { findElement, parseScene, serializeScene, type Point, type Scene } from "./scene";

interface Viewport { path: string; cx: number; cy: number; scale: number }
const viewports = new WeakMap<Tab, Viewport>();
let prefixes = 0;
const MIN_SCALE = 1 / 64;
const MAX_SCALE = 16;
const HEAVY_TEXT = 80_000;
const SAVE_DELAY = 300;
const BULK = 150;
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
  let scene: Scene | null = null;
  let painting = false;
  let textSeen = "";
  let darkSeen = false;
  let loadGen = 0;
  let chunkGen = 0;
  let parseTimer = 0;
  let chunkTimer = 0;
  let saveTimer = 0;
  let gone = false;
  let patches = 0;
  let notifying = false;
  let writing = Promise.resolve();
  // Texts this tab wrote lately: a watcher event that reads one back is our own save.
  const ours: string[] = [];
  const patchDefs = new Map<string, Element>();
  let space = false;
  let cancelDrag: (() => void) | undefined;
  const theme = new MutationObserver(() => {
    const dark = document.documentElement.classList.contains("theme-dark");
    if (dark === darkSeen || !textSeen) return;
    darkSeen = dark;
    chunkGen++;
    clearTimeout(parseTimer);
    parseTimer = window.setTimeout(() => { if (scene) paint(scene, dark); else mount(textSeen, dark); }, 0);
  });

  const svgOf = () => world.firstElementChild instanceof SVGSVGElement ? world.firstElementChild : null;

  function draw() {
    if (!state || !viewW || !viewH) return;
    const x = viewW / 2 - state.cx * state.scale;
    const y = viewH / 2 - state.cy * state.scale;
    world.style.transform = `translate(${x}px, ${y}px) scale(${state.scale})`;
    viewports.set(tab, state);
    editor.viewChanged();
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
    state = { path, cx: viewBox.x + viewBox.width / 2, cy: viewBox.y + viewBox.height / 2, scale };
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
    scene = null;
    painting = false;
    world.replaceChildren();
    message.hidden = false;
    message.textContent = text;
    images?.revoke();
    images = null;
    editor.reset();
  }

  function applyChrome(picture: DrawingPicture) {
    el.style.backgroundColor = picture.background;
    gridStep = picture.grid ?? 0;
    el.style.backgroundImage = gridStep
      ? "radial-gradient(circle at .7px .7px, var(--background-modifier-border) .7px, transparent .7px)"
      : "";
    if (!gridStep) { el.style.backgroundSize = ""; el.style.backgroundPosition = ""; }
  }

  function parseSvg(markup: string): SVGSVGElement | null {
    const holder = document.createElement("div");
    holder.innerHTML = markup;
    return holder.querySelector("svg");
  }

  function appendChunk(svg: SVGSVGElement, chunk: string) {
    const parsed = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg">${chunk}</svg>`);
    if (!parsed) return;
    while (parsed.firstChild) svg.appendChild(parsed.firstChild);
  }

  function place(svg: SVGSVGElement, box: DrawingPicture["viewBox"]) {
    svg.style.left = `${box.x}px`;
    svg.style.top = `${box.y}px`;
  }

  function mount(text: string, dark: boolean) {
    const parsed = parseScene(text);
    if (!parsed.ok) { fail(parsed.error); return; }
    scene = parsed.scene;
    paint(parsed.scene, dark);
  }

  function paint(next: Scene, dark: boolean) {
    message.hidden = true;
    images?.revoke();
    images = openDrawingImages(next);
    patchDefs.clear();
    const heavy = next.elements.length > 400;
    const picture = renderDrawing(next, { dark, images: images.href, idPrefix: prefix, paper: false, omitMarkup: heavy });
    viewBox = picture.viewBox;
    emptyScene = !next.elements.some((e) => !e.isDeleted);
    applyChrome(picture);
    chunkGen++;
    clearTimeout(chunkTimer);
    if (!heavy) {
      world.innerHTML = picture.markup;
      const svg = svgOf();
      if (svg) place(svg, picture.viewBox);
      painting = false;
    } else {
      world.innerHTML = picture.shell;
      const svg = svgOf();
      if (svg) place(svg, picture.viewBox);
      const mine = chunkGen;
      let index = 0;
      painting = !!svg && picture.chunks.length > 0;
      const step = () => {
        if (mine !== chunkGen || !svg) return;
        const chunk = picture.chunks[index++];
        if (!chunk) return;
        appendChunk(svg, chunk);
        if (index < picture.chunks.length) chunkTimer = window.setTimeout(step, 0);
        else { painting = false; editor.painted(); }
      };
      if (painting) chunkTimer = window.setTimeout(step, 0);
    }
    if (!state) fit();
    else draw();
    editor.painted();
  }

  const nodeOf = (id: string): SVGElement | null => svgOf()?.querySelector<SVGElement>(`:scope > [data-id="${CSS.escape(id)}"]`) ?? null;

  // Draw each element again on its own and swap it in where its node was, or
  // where it belongs in the stacking order if it had none.
  function repaint(ids: Iterable<string>) {
    const svg = svgOf();
    if (!svg || !scene) return;
    const touched = new Set(ids);
    // A big change (select all, then move or undo) paints the whole drawing in chunks instead.
    if (touched.size > BULK) { paint(scene, darkSeen); return; }
    const order = new Map<string, number>();
    for (const id of touched) {
      const old = nodeOf(id);
      patchDefs.get(id)?.remove();
      patchDefs.delete(id);
      const elem = findElement(scene, id);
      if (!elem || elem.isDeleted) { old?.remove(); continue; }
      const picture = renderDrawing({ ...scene, elements: [elem] }, { dark: darkSeen, images: images?.href, idPrefix: `${prefix}p${++patches}`, paper: false });
      const parsed = parseSvg(picture.markup);
      const node = parsed?.querySelector<SVGElement>(":scope > [data-id]");
      const defs = parsed?.querySelector(":scope > defs");
      if (defs) { svg.insertBefore(defs, svg.firstChild); patchDefs.set(id, defs); }
      if (!node) { old?.remove(); continue; }
      if (old) { old.replaceWith(node); continue; }
      if (!order.size) scene.elements.forEach((e, i) => order.set(e.id, i));
      const at = order.get(id) ?? scene.elements.length;
      let before: SVGElement | null = null;
      for (let i = at + 1; i < scene.elements.length && !before; i++) before = nodeOf(scene.elements[i].id);
      svg.insertBefore(node, before);
    }
    emptyScene = !scene.elements.some((e) => !e.isDeleted);
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (gone || !scene) return;
    // Mid-gesture the scene holds unstamped live frames: wait for the gesture to end.
    // A closed tab must not keep rescheduling this.
    if (editor.busy) { changed(); return; }
    const text = serializeScene(scene);
    textSeen = text;
    ours.push(text);
    if (ours.length > 4) ours.shift();
    writing = writing.then(async () => {
      try {
        await api.writeNote(path, text);
        notifying = true;
        try { ws.vault.written(path); } finally { notifying = false; }
      } catch (err) { console.error(`Could not save ${path}`, err); }
    });
  }

  function changed() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, SAVE_DELAY);
  }

  const toScene = (clientX: number, clientY: number): Point => {
    const rect = el.getBoundingClientRect();
    const s = state ?? { cx: 0, cy: 0, scale: 1 };
    return [s.cx + (clientX - rect.left - viewW / 2) / s.scale, s.cy + (clientY - rect.top - viewH / 2) / s.scale];
  };
  const toScreen = (p: Point): Point => {
    const s = state ?? { cx: 0, cy: 0, scale: 1 };
    return [viewW / 2 + (p[0] - s.cx) * s.scale, viewH / 2 + (p[1] - s.cy) * s.scale];
  };

  const editor = drawingEditor({
    el,
    scene: () => scene,
    ready: () => !!scene && !painting && !!state,
    toScene,
    toScreen,
    scale: () => state?.scale ?? 1,
    node: nodeOf,
    repaint,
    changed,
  });

  function load() {
    const gen = ++loadGen;
    // Keep the current paint running until different content replaces it.
    // Duplicate watcher events may read identical bytes during chunked paint.
    clearTimeout(parseTimer);
    void api.readNote(path).then((text) => {
      if (gen !== loadGen) return;
      const dark = document.documentElement.classList.contains("theme-dark");
      if ((text === textSeen || ours.includes(text)) && dark === darkSeen && svgOf()) return;
      // Someone else changed the file: it wins over edits not yet saved, as on a canvas.
      clearTimeout(saveTimer);
      saveTimer = 0;
      ours.length = 0;
      textSeen = text;
      darkSeen = dark;
      parseTimer = window.setTimeout(() => {
        if (gen !== loadGen) return;
        editor.reset();
        if (text.length > HEAVY_TEXT) {
          const parsed = parseScene(text);
          if (!parsed.ok) { fail(parsed.error); return; }
          scene = parsed.scene;
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
  const unwatch = ws.vault.onModified((changedPath) => { if (changedPath === path && !notifying) load(); });

  el.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (!state || (event.target as Element).closest(".drawing-controls, .drawing-toolbar, .drawing-style, .drawing-help")) return;
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
    if ((event.target as Element).closest(".drawing-controls, .drawing-toolbar, .drawing-style, .drawing-help, .drawing-text-editor")) return;
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
    if ((event.target as Element).closest(".drawing-controls, .drawing-toolbar, .drawing-style, .drawing-help")) return;
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

  const flush = () => {
    editor.endLive();
    if (saveTimer) save();
  };
  window.addEventListener("beforeunload", flush);

  load();
  return {
    el,
    dispose() {
      // Drop a gesture in progress first, so what's saved is the last finished edit.
      editor.dispose();
      flush();
      gone = true;
      clearTimeout(saveTimer);
      saveTimer = 0;
      window.removeEventListener("beforeunload", flush);
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
