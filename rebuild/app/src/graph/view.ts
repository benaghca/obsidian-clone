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
// A tick too long for one frame is spread over several (`Simulation.advance`,
// review 4): the same layout, tick for tick, with frames drawn in between.
//
// The webview's canvas is drawn on the CPU in WebKitGTK. While the graph
// moves, a canvas far too slow to draw at full resolution is drawn at one
// pixel per CSS pixel, then once more at full resolution when it comes to
// rest. While it settles on its own (nobody touching it) a slow canvas is
// drawn every other frame, leaving the rest of each frame to the editor.
// The graph follows the vault through the workspace's "links" and "files"
// changes (which come a moment after a save, never on a keystroke), and an
// update keeps every node that is still there where it is. A "links" change
// that changed no note this graph can show is skipped (`linksMatter`).

import { linkEntryOf } from "../links/linkDelta";
import { duration } from "../motion";
import { h } from "../shell/dom";
import type { OpenWhere } from "../tabs";
import type { Workspace } from "../workspace";
import { camera, easeZoom, fitAround, hitTest, panBy, toWorld, wheelZoom } from "./camera";
import { drawOrder, type GraphModel, type GraphNode, localLinksMatter, neighbourSteps, nodeColor, nodeRadius, sameShape } from "./data";
import { type Colors, drawGraph, readGraphColors } from "./draw";
import { graphInput } from "./input";
import { createGraphPanel } from "./panel";
import { devBuildHold, devBuildHolding, devBuilt, devHold, devStats, setProbe } from "./probe";
import { changedIn, DATA_KEYS, FORCE_KEYS, graphSettings, resetGraphSettings, setGraphSetting } from "./settings";
import { type SimGraph, Simulation } from "./sim";
import { type ColorRule, createGraphSource, type Facts } from "./source";
import type { GraphSettings } from "../settings/schema";
import { settings } from "../settings/store";

interface GraphHost {
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
/** Longest stretch of an update's rebuild in one task (ms). */
const SLICE_MS = 6;
/**
 * Most of a frame the layout may take (ms). A tick that takes longer (about 95 ms at 50,000
 * nodes) goes on in the next frames (review 4); one that fits still takes one frame, as before.
 */
const TICK_MS = 12;
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
  /** The next install lays the graph out again even when its shape is the same (a timelapse). */
  let relayout = true;
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
   * The sliced rebuild under way (its `seq`), from the links as they were when it started; 0
   * for none. Review 7: one cancelled by `scheduleRebuild` is no longer under way, and only a
   * build's own `seq` clears it, so an older one stopping never clears a newer one's.
   */
  let building = 0;
  /** A rebuild's new layout graph, waiting for the tick under way to end (`step`). */
  let waiting: Prepared | null = null;
  /**
   * Review 8: link changes made while the build under way runs, checked against its model
   * before it goes in, so changes it cannot show don't start it over. Null when it can't be
   * checked that way (a first build, the global graph, a build reading note text or showing a
   * timelapse): a link change then cancels it, as before.
   */
  let heldTouch: Set<string> | null = null;
  /** Whether `waiting` came from such a build (and was checked when it was done). */
  let waitingChecked = false;

  /**
   * Rebuild the model from the vault and options. Runs synchronously when
   * nothing has to be asked of the backend (no tags, no text search), so the
   * first frame of a new graph already has its nodes.
   */
  async function rebuild() {
    const mine = ++seq;
    stale = false;
    // This rebuild starts from what is shown, so one still waiting is superseded.
    waiting = null;
    let facts: Facts | null = null;
    const asked = source.facts(cfg);
    if (asked) {
      facts = await asked;
      if (mine !== seq || disposed) return;
    }
    const started = performance.now();
    const center = local ? (host.file?.() ?? null) : null;
    const shown = reveal ? new Set(reveal.order.slice(0, reveal.shown)) : null;
    // A first build runs to the end now, so a new graph's first frame has its nodes. An
    // update of a graph already on screen runs in slices of at most SLICE_MS, a frame apart,
    // while the old one stays up (review 2): a 50k-note rebuild no longer takes one long task.
    // Review 3: so does preparing it for the screen (`prepare`); only `install` is left for
    // the last slice.
    const built_ = source.buildSteps(cfg, facts, center, shown);
    const steps = (function* () {
      const { model: next, groups } = yield* built_;
      return yield* prepare(next, groups);
    })();
    // The build reads the vault's links once, in its first step (`buildSteps`).
    const read = ws.vault.links;
    const checked = built && local && !reveal && !source.readsText(cfg);
    building = mine;
    heldTouch = checked ? new Set() : null;
    let step = steps.next();
    let slice = performance.now();
    let work = 0;
    let longest = 0;
    for (;;) {
      // Tests (dev only): held after its first step, and (review 8) after each later one.
      if (built && devBuildHold && devBuildHolding?.()) {
        await devBuildHold(mine);
        if (mine !== seq || disposed) return;
        slice = performance.now();
      }
      if (step.done) break;
      if (built && !reveal && performance.now() - slice > SLICE_MS) {
        longest = Math.max(longest, performance.now() - slice);
        work += performance.now() - slice;
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (mine !== seq || disposed) return;
        slice = performance.now();
      }
      step = steps.next();
    }
    if (building === mine) {
      building = 0;
      const touched = heldTouch;
      heldTouch = null;
      // A link change made meanwhile that reaches this model's notes (by their old links or
      // their new ones): build again from the links as they now are.
      if (touched?.size && localLinksMatter(touched, step.value.next.index, false, cfg.hideUnresolved, (path) => linkEntryOf(ws.vault.links, path), (path) => linkEntryOf(read, path))) {
        source.forget();
        scheduleRebuild();
        return;
      }
    }
    const installing = performance.now();
    // A new layout graph goes in between ticks: the next frame puts it in once the tick under
    // way ends (review 4). Anything else goes in now.
    if (step.value.graph && (sim.ticking || devHold?.())) {
      waiting = step.value;
      waitingChecked = checked;
      invalidate();
    } else install(step.value);
    devBuilt?.(work + performance.now() - slice, performance.now() - started, Math.max(longest, performance.now() - slice), performance.now() - installing);
  }

  /** A model made ready for the screen by `prepare`, for `install`. */
  interface Prepared {
    next: GraphModel;
    groups: ColorRule[];
    radius: Float64Array<ArrayBuffer>;
    adjStart: Int32Array<ArrayBuffer>;
    adj: Int32Array<ArrayBuffer>;
    colorOf: Int16Array<ArrayBuffer>;
    order: Int32Array<ArrayBuffer>;
    /** The layout's new graph, when the nodes or links differ from the shown ones. */
    graph: SimGraph | null;
    known: number;
  }

  /**
   * Everything a new model needs on screen that does not depend on where the shown
   * nodes are now, in steps, without touching what is shown (review 3).
   */
  function* prepare(next: GraphModel, groups: ColorRule[]): Generator<void, Prepared> {
    const prev = model;
    const changed = relayout || !(yield* sameShape(prev, next));
    const n = next.nodes.length;
    const radius = new Float64Array(n);
    const colorOf = new Int16Array(n);
    // Each node's colour: its group's (the first that matches), else by kind (nodeColor).
    for (let i = 0; i < n; i++) {
      if ((i & 1023) === 1023) yield;
      radius[i] = nodeRadius(next.nodes[i].weight);
      colorOf[i] = nodeColor(next.nodes[i], groups);
    }
    const { start, adj } = yield* neighbourSteps(n, next.links); // for hover
    // Draw order: by colour, so each colour is one path (each colour's nodes in index order,
    // as the stable sort by colour this replaces gave).
    const order = drawOrder(colorOf);
    let graph: SimGraph | null = null;
    let known = 0;
    if (changed) {
      const saved = !local ? layouts.get(ws.vault.path) : undefined;
      const shown = sim.x.length;
      graph = yield* sim.prepareGraph(
        next.nodes.map((node) => node.id),
        next.links,
        (id) => {
          const i = prev.index.get(id);
          if (i !== undefined && i < shown) {
            known++;
            return i;
          }
          const p = saved?.get(id);
          if (p) known++;
          return p ? [p[0], p[1], 0, 0] : undefined;
        },
      );
    }
    return { next, groups, radius, adjStart: start, adj, colorOf, order, graph, known };
  }

  /** Show a prepared model. The layout's nodes keep their current places. */
  function install(p: Prepared) {
    const { next, groups, graph } = p;
    model = next;
    const n = next.nodes.length;
    radius = p.radius;
    adjStart = p.adjStart;
    adj = p.adj;
    highlighted = new Uint8Array(n);
    applyPalette(groups);
    colorOf = p.colorOf;
    order = p.order;
    if (graph) {
      relayout = false;
      sim.installGraph(graph);
      // A first build from scratch starts hot; one that mostly knows where
      // things are (a reopened graph, an edit) only warms up a little.
      if (!built) sim.alpha = n && p.known / n > 0.9 ? 0.3 : 1;
      else sim.reheat(reveal ? 0.5 : 0.3);
      hovered = shownHover = -1;
    }
    built = true;
    invalidate();
  }

  function applyPalette(groups: ColorRule[]) {
    const c = colors ?? readColors();
    palette = [c.node, c.unresolved, c.tag, c.attachment, ...groups.map((g) => `#${g.rgb.toString(16).padStart(6, "0")}`)];
    paletteAlpha = [1, 0.5, 1, 1, ...groups.map(() => 1)];
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
    // A model still waiting to go in is older than what asked for this rebuild: drop it, and
    // the shown one stays up until the rebuild is done (review 5). So is one still being built
    // (review 6): it stops at its next slice instead of going in, and (review 7) no longer
    // counts as under way for `linksMatter`. A first build still finishes, so a new graph is
    // never left empty.
    waiting = null;
    if (built) {
      seq++;
      building = 0;
      heldTouch = null;
    }
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
    // whose nodes aren't on screen yet is drawn first, one waiting for the
    // tick under way included.)
    if (!input.drag && !input.panning && cam.zoomAt === null && drawnModel === model && !waiting && started - lastKey < TYPING_PAUSE) {
      lastFrame = 0;
      clearTimeout(typingWait);
      typingWait = window.setTimeout(invalidate, TYPING_PAUSE - (started - lastKey) + 10);
      return;
    }
    const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;
    let more = false;
    if (reveal) more = advanceTimelapse() || more;
    if (!sim.settled || sim.ticking) {
      if (sim.advance(started + TICK_MS) && sim.settled) rememberLayout();
      more = true;
    }
    // A new graph waits for the tick under way (its nodes move when it ends).
    if (waiting && !sim.ticking && !devHold?.()) {
      const p = waiting;
      waiting = null;
      install(p);
      more = true;
    } else if (waiting) more = true;
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
    // A node dragged during a tick in steps is drawn where it was put (`Simulation.place`).
    sim.showing(drawNow);
  }

  function drawNow() {
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
  const nodeAt = (px: number, py: number) => sim.showing(() => hitTest(cam, px, py, sim.x, sim.y, radius, cfg.nodeSizeMultiplier));

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
      const [wx, wy] = toWorld(cam, x, y);
      sim.place(i, wx, wy);
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
    relayout = true;
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
      void rebuild();
    }
    invalidate();
  });

  function applyForces() {
    sim.forces = { center: cfg.centerStrength, repel: cfg.repelStrength, link: cfg.linkStrength, distance: cfg.linkDistance };
  }
  applyForces();

  /** Whether a link refresh that changed `touched` notes' entries can change this graph (`localLinksMatter`). */
  function linksMatter(touched: ReadonlySet<string> | null): boolean {
    // A rebuild in flight read older links than these: judge nothing against the old model.
    // Nor while a rebuilt model waits to go in (review 5): it was built from links before these,
    // and the shown model says nothing about the notes it adds.
    // Review 8: a model that was checked when its build was done is judged instead of the shown
    // one, since it is what goes in.
    if (building !== 0 || (waiting && !waitingChecked)) return true;
    const { links, linkPrev } = ws.vault;
    return localLinksMatter(
      touched,
      local ? (waiting?.next ?? model).index : null,
      source.readsText(cfg),
      cfg.hideUnresolved,
      (path) => linkEntryOf(links, path),
      (path) => linkEntryOf(linkPrev, path),
    );
  }

  // The vault changed (a moment after a save, never on a keystroke): update in place.
  const onChange = (change: string) => {
    if (disposed) return;
    if (change === "links") {
      const touched = ws.vault.linkTouch;
      if (building !== 0 && heldTouch && touched) {
        // Review 8: checked against the build under way's model when it is done (`rebuild`).
        for (const path of touched) heldTouch.add(path);
        return;
      }
      if (!linksMatter(touched)) return;
    }
    if (change === "links" || change === "files") {
      source.forget();
      scheduleRebuild();
    } else if (change === "doc") {
      // A later rebuild flushes this edit before reusing saved-query results.
      source.forget();
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
