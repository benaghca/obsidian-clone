// The graph view: the vault's notes as nodes and their links as lines, laid
// out by the force simulation (sim.ts), drawn on one Canvas 2D element
// (draw.ts) through a pannable, zoomable camera (camera.ts), with Obsidian's
// settings panel floating in the corner (panel.ts). Used for the global
// graph in a tab and for the local graph (one note's neighbourhood) in a tab
// or the right sidebar. Drag empty space to pan, the wheel or a pinch to
// zoom around the pointer, drag a node to move it (its neighbours follow).
//
// Work is done only while something moves: each frame ticks the simulation
// (while it is still cooling), eases the zoom and the hover fade, and draws.
// When all of that has settled no frame is requested at all, and a hidden
// graph (a background tab, a closed sidebar) does nothing until shown.
//
// The webview's canvas is drawn on the CPU in WebKitGTK. While the graph
// moves, a canvas far too slow to draw at full resolution is drawn at one
// pixel per CSS pixel, then once more at full resolution when it comes to
// rest. While it settles on its own (nobody touching it) a slow canvas is
// drawn every other frame, leaving the rest of each frame to the editor.
// The graph follows the vault through the workspace's "links" and "files"
// changes (which come a moment after a save, never on a keystroke), and an
// update keeps every node that is still there where it is.

import { duration } from "../motion";
import { h } from "../shell/dom";
import type { OpenWhere } from "../tabs";
import type { Workspace } from "../workspace";
import { camera, easeZoom, fitAround, hitTest, panBy, toWorld, wheelZoom } from "./camera";
import { type GraphModel, type GraphNode, neighbours, nodeColor, nodeRadius } from "./data";
import { type Colors, drawGraph, readGraphColors } from "./draw";
import { graphInput } from "./input";
import { createGraphPanel } from "./panel";
import { devStats, setProbe } from "./probe";
import { changedIn, DATA_KEYS, FORCE_KEYS, graphSettings, resetGraphSettings, setGraphSetting } from "./settings";
import { Simulation } from "./sim";
import { type ColorRule, createGraphSource, type Facts } from "./source";
import type { GraphSettings } from "../settings/schema";
import { settings } from "../settings/store";

export interface GraphHost {
  ws: Workspace;
  /** The local graph (one note's neighbourhood) rather than the whole vault. */
  local: boolean;
  /** The note a local graph is centred on. */
  file?(): string | null;
  /** Open a node's note (a click), in the tab, a new tab or to the right. */
  open(path: string, where: OpenWhere): void;
  /** A note that doesn't exist yet (an unresolved node): create and open it. */
  openMissing(name: string, where: OpenWhere): void;
  /** A tag node was clicked: search the vault for it. */
  searchTag(tag: string): void;
  /** Right-click on a note node. */
  menu(path: string, at: { x: number; y: number }): void;
  /** The panel starts closed whatever the settings say (the narrow sidebar). */
  panelClosed?: boolean;
}

export type GraphView = ReturnType<typeof createGraphView>;

const REFRESH_DELAY = 200;
/** A canvas slower than this (ms) to draw is drawn every other frame while it settles on its own. */
const SLOW_FRAME = 10;
/**
 * A frame that takes longer than this (ms) to draw at full resolution is
 * drawn at 1× while moving. Only then: WebKitGTK resamples a canvas whose
 * pixels don't match the screen's every time it composites the page, which
 * costs more than drawing (measured on a 2× screen with 1,011 nodes: pan
 * and wheel zoom at 1× had frames of 40–50 ms at p95, while full resolution
 * held 60 fps with 7–12 ms of drawing).
 */
const TOO_SLOW = 24;

/** When a key was last pressed outside a graph: graphs settling on their own wait for typing to pause. */
let lastKey = -Infinity;
const TYPING_PAUSE = 400;
window.addEventListener(
  "keydown",
  (e) => {
    if (!(e.target as Element | null)?.closest?.(".graph-view")) lastKey = performance.now();
  },
  true,
);

/** Where the global graph's nodes were, per vault, so reopening it starts from its settled layout. */
const layouts = new Map<string, Map<string, [number, number]>>();

export function createGraphView(host: GraphHost) {
  const { ws, local } = host;
  const canvas = h("canvas", { class: "graph-canvas" });
  const ctx = canvas.getContext("2d", { alpha: false })!;
  let cfg: GraphSettings = graphSettings(local);
  const panel = createGraphPanel({
    local,
    get: () => cfg,
    set: (key, value) => {
      setGraphSetting(local, key, value);
    },
    reset: () => resetGraphSettings(local),
    animate: () => startTimelapse(),
  });
  if (host.panelClosed) {
    panel.el.classList.add("is-close");
    panel.shadow.hidden = true;
  }
  const el = h("div", { class: `graph-view${local ? " mod-local" : ""}` }, canvas, panel.shadow, panel.el);

  let active = false;
  let disposed = false;
  const sim = new Simulation();
  let model: GraphModel = { nodes: [], links: [], index: new Map() };
  /** Per node: base radius, colour (index into `palette`), and alpha (unresolved nodes are fainter). */
  let radius = new Float64Array(0);
  let colorOf = new Int16Array(0);
  /** Neighbours of each node (CSR: `adj` from `adjStart[i]` to `adjStart[i + 1]`). */
  let adjStart = new Int32Array(1);
  let adj = new Int32Array(0);
  let palette: string[] = [];
  let paletteAlpha: number[] = [];
  let order = new Int32Array(0);
  let signature = "";
  let built = false;

  const cam = camera(cfg.scale);
  /** The screen's device pixels per CSS pixel. */
  let dpr = 1;
  /** The canvas's pixels per CSS pixel now: dpr, or 1 while moving if full resolution is slow. */
  let ratio = 1;
  /** How long the last full-resolution frame took to draw (ms). */
  let fullCost = 0;
  let lastCost = 0;
  /** The resolution used while moving when full resolution is slow (1, or lower if 1 is slow too). */
  let lowRatio = 1;
  let frameCount = 0;
  /** The local graph keeps its note in the middle until the view is panned or zoomed by hand. */
  let follow = local;

  // Hover: the node, its neighbours (highlighted) and the fade (0 none, 1 full).
  let hovered = -1;
  let shownHover = -1;
  let hoverFade = 0;
  let highlighted = new Uint8Array(0);
  let focusId: string | null = null;

  let colors: Colors | null = null;
  let frame = 0;
  let lastFrame = 0;

  // Timelapse ("Animate"): notes appear one after another in order of their last change.
  let reveal: { order: string[]; shown: number; perFrame: number } | null = null;

  // ----- data -----

  const source = createGraphSource(ws, local);
  let refreshTimer = 0;
  let seq = 0;
  let stale = true;

  /**
   * Rebuild the model from the vault and options. Runs synchronously when
   * nothing has to be asked of the backend (no tags, no text search), so the
   * first frame of a new graph already has its nodes.
   */
  async function rebuild() {
    const mine = ++seq;
    stale = false;
    let facts: Facts | null = null;
    const asked = source.facts(cfg);
    if (asked) {
      facts = await asked;
      if (mine !== seq || disposed) return;
    }
    const center = local ? (host.file?.() ?? null) : null;
    const shown = reveal ? new Set(reveal.order.slice(0, reveal.shown)) : null;
    const { model: next, groups } = source.build(cfg, facts, center, shown);
    setModel(next, groups);
  }

  function setModel(next: GraphModel, groups: ColorRule[]) {
    const sig = next.nodes.map((n) => n.id).join("\n") + "\n" + next.links.map((l) => `${l.source},${l.target}`).join(" ");
    const changed = sig !== signature;
    const prev = model;
    model = next;
    const n = next.nodes.length;
    radius = new Float64Array(n);
    for (let i = 0; i < n; i++) radius[i] = nodeRadius(next.nodes[i].weight);
    ({ start: adjStart, adj } = neighbours(n, next.links)); // for hover
    highlighted = new Uint8Array(n);
    applyColors(groups);
    if (changed) {
      signature = sig;
      const ox = sim.x;
      const oy = sim.y;
      const ovx = sim.vx;
      const ovy = sim.vy;
      const saved = !local ? layouts.get(ws.vault.path) : undefined;
      let known = 0;
      sim.setGraph(
        next.nodes.map((node) => node.id),
        next.links,
        (id) => {
          const i = prev.index.get(id);
          if (i !== undefined && i < ox.length) {
            known++;
            return [ox[i], oy[i], ovx[i], ovy[i]];
          }
          const p = saved?.get(id);
          if (p) known++;
          return p ? [p[0], p[1], 0, 0] : undefined;
        },
      );
      // A first build from scratch starts hot; one that mostly knows where
      // things are (a reopened graph, an edit) only warms up a little.
      if (!built) sim.alpha = n && known / n > 0.9 ? 0.3 : 1;
      else sim.reheat(reveal ? 0.5 : 0.3);
      hovered = shownHover = -1;
    }
    built = true;
    invalidate();
  }

  /** Each node's colour: its group's (the first that matches), else by kind (nodeColor). */
  function applyColors(groups: ColorRule[]) {
    const c = colors ?? readColors();
    palette = [c.node, c.unresolved, c.tag, c.attachment, ...groups.map((g) => `#${g.rgb.toString(16).padStart(6, "0")}`)];
    paletteAlpha = [1, 0.5, 1, 1, ...groups.map(() => 1)];
    const n = model.nodes.length;
    colorOf = new Int16Array(n);
    model.nodes.forEach((node, i) => (colorOf[i] = nodeColor(node, groups)));
    // Draw order: by colour, so each colour is one path.
    order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => colorOf[a] - colorOf[b]);
  }

  function readColors(): Colors {
    const read = readGraphColors(el);
    // Not in the document yet: nothing resolves, so read again next time.
    if (!read.node) return read;
    colors = read;
    if (palette.length) palette.splice(0, 4, read.node, read.unresolved, read.tag, read.attachment);
    return read;
  }

  function scheduleRebuild(delay = REFRESH_DELAY) {
    stale = true;
    clearTimeout(refreshTimer);
    if (active) refreshTimer = window.setTimeout(() => void rebuild(), delay);
  }

  // ----- frames -----

  function invalidate() {
    if (!frame && active && !disposed) frame = requestAnimationFrame(step);
  }

  let typingWait = 0;
  let drawnModel: GraphModel | null = null;
  function step(now: number) {
    const started = performance.now();
    frame = 0;
    // Nobody is touching the graph and someone is typing: let the editor have
    // the frames, and carry on settling once the typing pauses. (A graph
    // whose nodes aren't on screen yet is drawn first.)
    if (!input.drag && !input.panning && cam.zoomAt === null && drawnModel === model && started - lastKey < TYPING_PAUSE) {
      lastFrame = 0;
      clearTimeout(typingWait);
      typingWait = window.setTimeout(invalidate, TYPING_PAUSE - (started - lastKey) + 10);
      return;
    }
    const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;
    let more = false;
    if (reveal) more = advanceTimelapse() || more;
    if (!sim.settled) {
      sim.tick();
      more = true;
      if (sim.settled) rememberLayout();
    }
    // Zoom eases to its target around the point it was aimed at.
    if (cam.scale !== cam.target) {
      easeZoom(cam, dt, duration("fast") <= 0);
      more = true;
    }
    // Hover highlight fades in and out (instant with reduced motion).
    const want = hovered >= 0 ? 1 : 0;
    if (hoverFade !== want) {
      const ms = duration("moderate");
      hoverFade = ms <= 0 ? want : Math.max(0, Math.min(1, hoverFade + (want ? 1 : -1) * (dt / ms)));
      more = true;
    }
    if (hoverFade === 0 && hovered < 0) shownHover = -1;
    if (follow) followFocus();
    // Nodes may have moved under a still pointer.
    const { pointer } = input;
    if (pointer && !input.drag && !input.panning && more) setHover(nodeAt(pointer.x, pointer.y));
    // Settling on its own with a slow canvas: draw every other frame.
    const touched = !!input.drag?.moved || input.panning || cam.zoomAt !== null || hoverFade !== want;
    if (!more || touched || lastCost < SLOW_FRAME || ++frameCount % 2 === 0) {
      const moving = more || touched;
      // WebKitGTK may not show a frame drawn right after the canvas was
      // resized until something else repaints: draw the next one too.
      if (setRatio(moving && fullCost > TOO_SLOW ? Math.min(dpr, lowRatio) : dpr)) more = true;
      const t = performance.now();
      draw();
      lastCost = performance.now() - t;
      if (ratio === dpr) fullCost = lastCost;
      // Still slow at the lower resolution: go lower (to half), and back up when there is room.
      else if (lastCost > SLOW_FRAME * 1.2) lowRatio = Math.max(0.5, lowRatio * 0.85);
      else if (lastCost < SLOW_FRAME / 2) lowRatio = Math.min(1, lowRatio / 0.85);
    }
    if (more) invalidate();
    else lastFrame = 0;
    devStats?.(performance.now() - started, model.nodes.length, more);
  }

  /**
   * The local graph, until it is panned or zoomed by hand: its note in the
   * middle, zoomed out (never in past the saved zoom) so the whole
   * neighbourhood fits, which matters in the narrow sidebar.
   */
  function followFocus() {
    const f = focusId === null ? undefined : model.index.get(focusId);
    if (f !== undefined && cam.width && cam.height) fitAround(cam, sim.x, sim.y, model.nodes.length, f, cfg.scale);
  }

  function rememberLayout() {
    if (local || !ws.vault.path) return;
    const map = new Map<string, [number, number]>();
    model.nodes.forEach((n, i) => map.set(n.id, [sim.x[i], sim.y[i]]));
    layouts.set(ws.vault.path, map);
  }

  // ----- drawing -----

  function draw() {
    if (!cam.width || !cam.height) return;
    const c = colors ?? readColors();
    drawnModel = model;
    drawGraph(ctx, {
      width: cam.width,
      height: cam.height,
      ratio,
      background: getBackground(),
      colors: c,
      cfg,
      model,
      x: sim.x,
      y: sim.y,
      radius,
      colorOf,
      order,
      palette,
      paletteAlpha,
      highlighted,
      scale: cam.scale,
      offX: cam.offX,
      offY: cam.offY,
      hover: shownHover,
      fade: hoverFade,
      focus: focusId === null ? -1 : (model.index.get(focusId) ?? -1),
      follow,
    });
  }

  let background = "";
  const getBackground = () => background || (el.isConnected ? (background = getComputedStyle(el).backgroundColor) : "#fff");

  // ----- hit testing and hover -----

  /** The node under a point (canvas pixels), or -1. */
  const nodeAt = (px: number, py: number) => hitTest(cam, px, py, sim.x, sim.y, radius, cfg.nodeSizeMultiplier);

  function setHover(i: number) {
    if (i === hovered) return;
    hovered = i;
    if (i >= 0) {
      shownHover = i;
      highlighted.fill(0);
      highlighted[i] = 1;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) highlighted[adj[k]] = 1;
      canvas.title = model.nodes[i].path ?? model.nodes[i].label;
    } else canvas.removeAttribute("title");
    invalidate();
  }

  // ----- pointer -----

  const input = graphInput(canvas, {
    nodeAt,
    hover: setHover,
    dragNode(i, x, y, first) {
      if (first) {
        sim.fixed[i] = 1;
        sim.alphaTarget = 0.3;
        sim.reheat(0.3);
      }
      [sim.x[i], sim.y[i]] = toWorld(cam, x, y);
      invalidate();
    },
    dropNode(i) {
      sim.fixed[i] = 0;
      sim.alphaTarget = 0;
      invalidate();
    },
    click: (i, where) => openNode(model.nodes[i], where),
    panStart() {
      follow = false;
      el.classList.add("is-panning");
    },
    panBy(dx, dy) {
      panBy(cam, dx, dy);
      invalidate();
    },
    panEnd() {
      el.classList.remove("is-panning");
      invalidate(); // the last frame at full resolution
    },
    wheel(x, y, e) {
      follow = false;
      wheelZoom(cam, x, y, e);
      saveScale();
      invalidate();
    },
    menu(i, at) {
      const node = model.nodes[i];
      if (node?.path && node.kind === "note") host.menu(node.path, at);
    },
  });

  function openNode(node: GraphNode | undefined, where: OpenWhere) {
    if (!node) return;
    if (node.kind === "tag") host.searchTag(node.label);
    else if (node.kind === "unresolved") host.openMissing(node.label, where);
    else if (node.path) host.open(node.path, where);
  }

  let scaleTimer = 0;
  const saveScale = () => {
    clearTimeout(scaleTimer);
    scaleTimer = window.setTimeout(() => setGraphSetting(local, "scale", Math.round(cam.target * 1e4) / 1e4), 500);
  };

  // ----- timelapse -----

  function startTimelapse() {
    const mtime = new Map(ws.vault.files.map((f) => [f.path, f.mtime_ms]));
    const paths = ws.vault.files.filter((f) => !f.is_dir).map((f) => f.path);
    paths.sort((a, b) => (mtime.get(a) ?? 0) - (mtime.get(b) ?? 0) || a.localeCompare(b));
    reveal = { order: paths, shown: 0, perFrame: Math.max(1, Math.ceil(paths.length / 240)) };
    signature = "";
    sim.alpha = 1;
    invalidate();
  }

  /** Show the next few notes; false once all are shown. */
  function advanceTimelapse(): boolean {
    if (!reveal) return false;
    reveal.shown += reveal.perFrame;
    const done = reveal.shown >= reveal.order.length;
    void rebuild();
    if (done) reveal = null;
    return !done;
  }

  // ----- size, theme, settings -----

  const resize = new ResizeObserver(() => measure());
  function measure() {
    // Whole CSS pixels (a pane can be 377.5px wide): see setRatio.
    const box = el.getBoundingClientRect();
    const w = Math.floor(box.width);
    const hgt = Math.floor(box.height);
    const device = window.devicePixelRatio || 1;
    if (w === cam.width && hgt === cam.height && device === dpr) return;
    cam.width = w;
    cam.height = hgt;
    dpr = device;
    setRatio(dpr, true);
    // Resizing clears the canvas: draw now, before the frame is painted, and
    // once more next frame (see step).
    draw();
    invalidate();
  }

  /**
   * Size the canvas for `r` canvas pixels per CSS pixel. The element gets a
   * whole number of CSS pixels and exactly the canvas's pixels' worth, not
   * "100%": in a pane 377.5px wide, WebKitGTK composites a 755px canvas into
   * a 378px (756 device pixel) layer, resampling it every time anything on
   * the page is painted (measured: the editor's frames in the next pane took
   * 47ms instead of 19ms, and 85ms with a wider pane). The background shows
   * in the sub-pixel strip left over.
   */
  function setRatio(r: number, force = false): boolean {
    if (r === ratio && !force) return false;
    ratio = r;
    canvas.width = Math.max(1, Math.round(cam.width * r));
    canvas.height = Math.max(1, Math.round(cam.height * r));
    canvas.style.width = `${canvas.width / r}px`;
    canvas.style.height = `${canvas.height / r}px`;
    return true;
  }

  // The scheme or accent changed (classes and variables on <html>): read the colours again.
  const themeWatch = new MutationObserver(() => {
    panel.restyle();
    colors = null;
    background = "";
    readColors();
    invalidate();
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
  themeWatch.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });

  let excluded = ws.vault.isExcluded;
  const offSettings = settings.on((file) => {
    // Settings → Files and links → Excluded files: those notes leave the graph
    // (checked once the app has applied the change, whichever listener runs first).
    if (file === "app.json" || file === null) {
      queueMicrotask(() => {
        if (ws.vault.isExcluded === excluded || disposed) return;
        excluded = ws.vault.isExcluded;
        scheduleRebuild(0);
      });
    }
    if (file !== "graph.json" && file !== null) return;
    const before = cfg;
    cfg = graphSettings(local);
    panel.sync();
    applyForces();
    if (changedIn(before, cfg, FORCE_KEYS)) {
      sim.reheat(0.3);
      sim.alphaTarget = 0;
    }
    if (changedIn(before, cfg, DATA_KEYS)) {
      if (before.showTags !== cfg.showTags) source.forget();
      void rebuild();
    }
    invalidate();
  });

  function applyForces() {
    sim.forces = { center: cfg.centerStrength, repel: cfg.repelStrength, link: cfg.linkStrength, distance: cfg.linkDistance };
  }
  applyForces();

  // The vault changed (a moment after a save, never on a keystroke): update in place.
  const onChange = (change: string) => {
    if (disposed) return;
    if (change === "links" || change === "files") {
      source.forget();
      scheduleRebuild();
    } else if (change === "show") {
      const path = ws.active.path;
      if (!local && path && path !== focusId) {
        focusId = path;
        invalidate();
      }
    }
  };
  const offWorkspace = ws.on(onChange);
  // The current note: the local graph's middle, or the note last shown in the global graph's place.
  focusId = local ? (host.file?.() ?? null) : (ws.active.path ?? ws.recent[0] ?? null);

  return {
    el,
    /** Shown or hidden: a hidden graph does no work at all. */
    setActive(next: boolean) {
      if (next === active || disposed) return;
      active = next;
      if (!active) {
        cancelAnimationFrame(frame);
        frame = 0;
        lastFrame = 0;
        clearTimeout(refreshTimer);
        resize.disconnect();
        return;
      }
      setProbe(canvas, cam, () => ({ model, x: sim.x, y: sim.y }), nodeAt);
      resize.observe(el);
      colors = null;
      background = "";
      measure();
      if (stale || !built) void rebuild();
      invalidate();
    },
    /** The local graph's note changed. */
    refresh() {
      if (local) {
        focusId = host.file?.() ?? null;
        follow = true;
      }
      clearTimeout(refreshTimer);
      if (active) void rebuild();
      else stale = true;
    },
    dispose() {
      disposed = true;
      active = false;
      rememberLayout();
      cancelAnimationFrame(frame);
      clearTimeout(refreshTimer);
      clearTimeout(scaleTimer);
      clearTimeout(typingWait);
      resize.disconnect();
      themeWatch.disconnect();
      offSettings();
      offWorkspace();
      el.remove();
    },
  };
}
