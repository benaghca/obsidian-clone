import { h, keyButton } from "../shell/dom";
import { icon } from "../shell/icons";
import { notice } from "../shell/notice";
import { canvasReadOnly } from "./controls";
import type { CanvasEdge, CanvasNode } from "./model";
import { PRESENT_GLIDE_MS, presentAction, slideFrame, slideMembers, stepIndex, type Camera } from "./present";
import { slideOrder } from "./slides";

export interface PresentHost {
  el: HTMLElement;
  nodes(): readonly CanvasNode[];
  edges(): readonly CanvasEdge[];
  selected(): readonly string[];
  reveal(ids: readonly string[]): void;
  clearReveal(): void;
  camera(): (Camera & { width: number; height: number }) | undefined;
  reflow(): void;
  jump(camera: Camera): void;
  glide(camera: Camera, ms: number): Promise<void>;
  cancelGlide(): void;
  hold(on: boolean): void;
  onHeldResize(fn: () => void): void;
  stopEditing(): void;
  keysBlocked(): boolean;
}

const starters = new WeakMap<HTMLElement, () => void>();

export function registerPresentation(el: HTMLElement, start: () => void) {
  starters.set(el, start);
  return () => { if (starters.get(el) === start) starters.delete(el); };
}

export function startCanvasPresentation(el: HTMLElement) {
  starters.get(el)?.();
}

const WHEEL_GAP = 650;

export function attachPresentation(host: PresentHost) {
  let on = false, current = 0, showGen = 0, addedReadOnly = false, wheeled = 0, fsGen = 0;
  let slides: CanvasNode[] = [];
  let saved: Camera | undefined;
  let ui: HTMLElement | undefined, countEl: HTMLElement | undefined;
  let down: { x: number; y: number; skip: boolean } | undefined;
  const events = new AbortController();
  const { signal } = events;

  host.onHeldResize(() => {
    if (!on) return;
    const size = host.camera();
    const slide = slides[current];
    if (!size || !slide) return;
    const frame = slideFrame(slide, size.width, size.height);
    if (frame) host.jump(frame);
  });

  function lock() {
    addedReadOnly = !canvasReadOnly.has(host.el);
    if (addedReadOnly) canvasReadOnly.add(host.el);
    host.el.classList.add("is-readonly", "is-presenting");
  }
  function unlock() {
    host.el.classList.remove("is-presenting");
    if (!addedReadOnly) return;
    canvasReadOnly.delete(host.el);
    host.el.classList.remove("is-readonly");
    addedReadOnly = false;
  }
  function fullscreen(value: boolean) {
    const mine = ++fsGen;
    if (!("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/window").then(mod => {
      if (mine !== fsGen) return;
      return mod.getCurrentWindow().setFullscreen(value);
    }).catch(() => {});
  }
  function mark() {
    const slide = slides[current];
    if (!slide) return;
    host.el.dataset.slideId = slide.id;
    host.el.dataset.slideIndex = String(current);
    host.el.dataset.slideCount = String(slides.length);
    if (countEl) countEl.textContent = `${current + 1} / ${slides.length}`;
  }
  function unmark() {
    delete host.el.dataset.slideId;
    delete host.el.dataset.slideIndex;
    delete host.el.dataset.slideCount;
  }
  async function show(index: number, animate: boolean) {
    if (!on || !slides.length) return;
    index = Math.max(0, Math.min(slides.length - 1, index));
    if (animate && index === current) return;
    const mine = ++showGen;
    current = index;
    mark();
    host.reveal(slideMembers(slides[current], host.nodes()).map(node => node.id));
    const size = host.camera();
    const frame = size && slideFrame(slides[current], size.width, size.height);
    if (!frame) return;
    if (animate) await host.glide(frame, PRESENT_GLIDE_MS);
    else host.jump(frame);
    if (mine !== showGen || !on) return;
    mark();
  }
  function go(delta: number) {
    if (!on || !slides.length) return;
    const next = stepIndex(current, slides.length, delta);
    if (next === current) return;
    void show(next, true);
  }
  function mountUi() {
    ui?.remove();
    countEl = h("span", { class: "canvas-present-count", role: "status", "aria-live": "polite" });
    const focus = () => host.el.focus({ preventScroll: true });
    ui = h("div", { class: "canvas-present-ui" },
      keyButton(icon("chevron-left"), "Previous slide", () => { go(-1); focus(); }),
      countEl,
      keyButton(icon("chevron-right"), "Next slide", () => { go(1); focus(); }),
      keyButton(icon("x"), "End presentation", () => { stop(true); focus(); }),
    );
    host.el.append(ui);
  }
  function stop(restore = true) {
    if (!on) return;
    on = false;
    showGen++;
    host.cancelGlide();
    document.body.classList.remove("is-canvas-presenting");
    ui?.remove();
    ui = undefined;
    countEl = undefined;
    unmark();
    unlock();
    host.clearReveal();
    fullscreen(false);
    host.hold(false);
    const back = saved;
    saved = undefined;
    slides = [];
    if (!back) return;
    // Esc measures after the chrome returns. Leaving still writes the saved
    // camera, so opening this canvas again shows the view from before the show.
    if (restore) host.reflow();
    host.jump(back);
  }
  function start() {
    if (on || !host.el.isConnected) return;
    if (document.body.classList.contains("is-canvas-presenting")) return;
    host.stopEditing();
    const order = slideOrder(host.nodes(), host.edges(), host.selected());
    if (!order.slides.length) {
      notice(["Add some cards to present"]);
      return;
    }
    slides = order.slides.slice();
    current = order.start;
    const cam = host.camera();
    saved = cam ? { cx: cam.cx, cy: cam.cy, scale: cam.scale } : undefined;
    on = true;
    host.hold(true);
    lock();
    document.body.classList.add("is-canvas-presenting");
    mountUi();
    host.el.focus({ preventScroll: true });
    fullscreen(true);
    host.reflow();
    void show(order.start, false);
  }

  window.addEventListener("keydown", e => {
    if (!on || host.keysBlocked()) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const target = e.target;
    if (target instanceof Element && target.closest("input, textarea, [contenteditable=true], [contenteditable=plaintext-only], .cm-editor")) return;
    const action = presentAction({ key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey });
    if (action === "next" && e.key === "Enter" && target instanceof Element && target.closest("a, [data-href]")) return;
    // Load, Reload and Open sit on the slide. Enter and Space activate them.
    if (target instanceof Element && target.closest("button") && (e.key === "Enter" || e.key === " " || e.key === "Space")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (action === "next") go(1);
    else if (action === "prev") go(-1);
    else if (action === "first") void show(0, true);
    else if (action === "last") void show(slides.length - 1, true);
    else if (action === "exit") stop(true);
  }, { capture: true, signal });

  host.el.addEventListener("wheel", e => {
    if (!on) return;
    const target = e.target as Element;
    if (target.closest(".canvas-present-ui")) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const content = target.closest<HTMLElement>(".canvas-node-content");
    if (content && content.scrollHeight > content.clientHeight + 1) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (Math.abs(e.deltaY) < 4) return;
    const now = performance.now();
    if (now - wheeled < WHEEL_GAP) return;
    wheeled = now;
    go(e.deltaY > 0 ? 1 : -1);
  }, { signal });

  host.el.addEventListener("pointerdown", e => {
    if (!on) return;
    const target = e.target as Element;
    const skip = !!target.closest("a, [data-href], button, .canvas-present-ui");
    down = { x: e.clientX, y: e.clientY, skip };
    if (skip) return;
    e.stopPropagation();
  }, { capture: true, signal });

  host.el.addEventListener("click", e => {
    if (!on || e.button !== 0 || e.detail > 1) return;
    const target = e.target as Element;
    if (target.closest("a, [data-href], button, .canvas-present-ui, .canvas-controls")) return;
    if (!down || down.skip || Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 3) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    go(1);
  }, { capture: true, signal });

  host.el.addEventListener("contextmenu", e => {
    if (!on) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if ((e.target as Element).closest(".canvas-present-ui")) return;
    go(-1);
  }, { capture: true, signal });

  host.el.addEventListener("dblclick", e => {
    if (!on) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true, signal });

  return {
    start, stop,
    dispose() { stop(false); events.abort(); },
  };
}
