// The graph view: the vault's notes as nodes and their links as lines, laid
// out by the force simulation (sim.ts) and drawn on one Canvas 2D element,
// with Obsidian's settings panel floating in the corner (panel.ts). Used for
// the global graph in a tab and for the local graph (one note's
// neighbourhood) in a tab or the right sidebar.
//
// Drawing follows what Obsidian's graph was observed to do: grey nodes that
// grow with their number of links, thin light lines, labels under the nodes
// that fade in as you zoom in (fully shown from 100% zoom, gone below 50%),
// nodes that shrink more slowly than the zoom (by its square root). Hovering
// a node highlights it, its links and its neighbours in the accent colour and
// dims everything else. Drag empty space to pan, the wheel or a pinch to zoom
// around the pointer, drag a node to move it (its neighbours follow).
//
// Work is done only while something moves: each frame ticks the simulation
// (while it is still cooling), eases the zoom and the hover fade, and draws.
// When all of that has settled no frame is requested at all, and a hidden
// graph (a background tab, a closed sidebar) does nothing until shown.
//
// The webview's canvas is drawn on the CPU (Cairo, in WebKitGTK), where a
// line costs in proportion to its length times its width in device pixels.
// So on a high-density screen lines are one device pixel wide, and while the
// graph moves a canvas that turns out slow to draw is drawn at one pixel per
// CSS pixel, then once more at full resolution when it comes to rest. While
// it settles on its own (nobody touching it) a slow canvas is drawn every
// other frame, leaving the rest of each frame to the editor.
// The graph follows the vault through the workspace's "links" and "files"
// changes (which come a moment after a save, never on a keystroke), and an
// update keeps every node that is still there where it is.

import { api } from "../api";
import { duration } from "../motion";
import { h } from "../shell/dom";
import { type OpenWhere, whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { buildGraph, type GraphModel, type GraphNode, nodeRadius } from "./data";
import { createGraphPanel } from "./panel";
import { type GraphQuery, isEmptyQuery, matchesQuery, parseGraphQuery } from "./query";
import { graphSettings, resetGraphSettings, setGraphSetting } from "./settings";
import { Simulation } from "./sim";
import type { GraphSettings } from "../settings/schema";
import { settings } from "../settings/store";
import { createTagReader } from "../shell/vaultTags";

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

export interface GraphView {
  el: HTMLElement;
  /** Shown or hidden: a hidden graph does no work at all. */
  setActive(active: boolean): void;
  /** The local graph's note changed. */
  refresh(): void;
  dispose(): void;
}

const MIN_SCALE = 1 / 128;
const MAX_SCALE = 8;
/** Wheel zoom: one notch (100px) zooms to about 71%, as in Obsidian. */
const WHEEL_ZOOM = 0.0034;
const PINCH_ZOOM = 0.01;
const DIM = 0.2;
const CLICK_SLOP = 4;
const LABEL_SIZE = 16;
const REFRESH_DELAY = 200;
/** A frame that takes longer than this (ms) to draw at full resolution is drawn at 1× while moving. */
const SLOW_FRAME = 10;

interface Colors {
  node: string;
  unresolved: string;
  tag: string;
  attachment: string;
  focused: string;
  highlight: string;
  line: string;
  lineHighlight: string;
  text: string;
  arrow: string;
  font: string;
}

/** Dev builds only: each frame's work (ms), for the measuring harness. */
const devStats = import.meta.env.DEV
  ? (ms: number, nodes: number, running: boolean) => {
      const w = window as unknown as { __graphWork?: number[]; __graphNodes?: number; __graphRunning?: boolean };
      (w.__graphWork ??= []).push(ms);
      w.__graphNodes = nodes;
      w.__graphRunning = running;
    }
  : null;

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

export function createGraphView(host: GraphHost): GraphView {
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

  // View transform: screen = centre of the canvas + offset + world × scale.
  let width = 0;
  let height = 0;
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
  let scale = cfg.scale;
  let targetScale = scale;
  let offX = 0;
  let offY = 0;
  let zoomAt: { sx: number; sy: number; wx: number; wy: number } | null = null;
  /** The local graph keeps its note in the middle until the view is panned or zoomed by hand. */
  let follow = local;

  // Hover: the node, its neighbours (highlighted) and the fade (0 none, 1 full).
  let hovered = -1;
  let shownHover = -1;
  let hoverFade = 0;
  let highlighted = new Uint8Array(0);
  let focusId: string | null = null;
  let pointer: { x: number; y: number } | null = null;

  let colors: Colors | null = null;
  let frame = 0;
  let lastFrame = 0;

  // Timelapse ("Animate"): notes appear one after another in order of their last change.
  let reveal: { order: string[]; shown: number; perFrame: number } | null = null;

  // ----- data -----

  const readTags = createTagReader(ws);
  let tagCache: Promise<Map<string, string[]>> | null = null;
  const textCache = new Map<string, Promise<Set<string>>>();
  let refreshTimer = 0;
  let seq = 0;
  let stale = true;

  const textHits = (text: string) => {
    let hits = textCache.get(text);
    if (!hits) {
      hits = api.search(text, 100_000).then(
        (list) => new Set(list.map((hit) => hit.path)),
        () => new Set<string>(),
      );
      textCache.set(text, hits);
    }
    return hits;
  };

  /**
   * Rebuild the model from the vault and options. Runs synchronously when
   * nothing has to be asked of the backend (no tags, no text search), so the
   * first frame of a new graph already has its nodes.
   */
  async function rebuild() {
    const mine = ++seq;
    stale = false;
    const query = parseGraphQuery(cfg.search);
    const groups = cfg.colorGroups.map((g) => ({ query: parseGraphQuery(g.query), color: g.color }));
    const queries: GraphQuery[] = [query, ...groups.map((g) => g.query)];
    const needTags = cfg.showTags || queries.some((q) => q.tags.length > 0);
    const texts = [...new Set(queries.map((q) => q.text).filter(Boolean))];
    let tags: Map<string, string[]> | undefined;
    const hits = new Map<string, Set<string>>();
    if (needTags || texts.length) {
      if (needTags) tagCache ??= readTags().catch(() => new Map());
      const [t, ...h] = await Promise.all([needTags ? tagCache : undefined, ...texts.map(textHits)]);
      if (mine !== seq || disposed) return;
      tags = t ?? undefined;
      texts.forEach((text, i) => hits.set(text, h[i]));
    }
    const facts = (q: GraphQuery) => ({ tags, textHits: hits.get(q.text) });
    const excluded = ws.isExcluded;
    const notes: string[] = [];
    const attachments: string[] = [];
    for (const f of ws.files) {
      if (f.is_dir || excluded(f.path)) continue;
      if (f.path.endsWith(".md")) notes.push(f.path);
      else attachments.push(f.path);
    }
    const center = local ? (host.file?.() ?? null) : null;
    let include = isEmptyQuery(query) ? undefined : (path: string) => path === center || matchesQuery(path, query, facts(query));
    if (reveal) {
      const shown = new Set(reveal.order.slice(0, reveal.shown));
      const base = include;
      include = (path) => shown.has(path) && (!base || base(path));
    }
    const next = buildGraph(
      { notes, attachments, links: ws.links, tags },
      {
        showTags: cfg.showTags,
        showAttachments: cfg.showAttachments,
        hideUnresolved: cfg.hideUnresolved,
        showOrphans: local || cfg.showOrphans,
        include,
        local: local
          ? { center: center ?? "", depth: cfg.localJumps, incoming: cfg.localBacklinks, outgoing: cfg.localForelinks, neighbors: cfg.localInterlinks }
          : undefined,
      },
    );
    setModel(next, groups.map((g) => ({ match: (n: GraphNode) => !!n.path && matchesQuery(n.path, g.query, facts(g.query)), rgb: g.color.rgb })));
  }

  function setModel(next: GraphModel, groups: { match: (n: GraphNode) => boolean; rgb: number }[]) {
    const sig = next.nodes.map((n) => n.id).join("\n") + "\n" + next.links.map((l) => `${l.source},${l.target}`).join(" ");
    const changed = sig !== signature;
    const prev = model;
    model = next;
    const n = next.nodes.length;
    radius = new Float64Array(n);
    for (let i = 0; i < n; i++) radius[i] = nodeRadius(next.nodes[i].weight);
    // Neighbour lists, for hover.
    const count = new Int32Array(n + 1);
    for (const l of next.links) {
      count[l.source + 1]++;
      count[l.target + 1]++;
    }
    for (let i = 0; i < n; i++) count[i + 1] += count[i];
    adjStart = count;
    adj = new Int32Array(count[n]);
    const fill = count.slice();
    for (const l of next.links) {
      adj[fill[l.source]++] = l.target;
      adj[fill[l.target]++] = l.source;
    }
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

  /** Each node's colour: its group's (the first that matches), else by kind. */
  function applyColors(groups: { match: (n: GraphNode) => boolean; rgb: number }[]) {
    const c = colors ?? readColors();
    palette = [c.node, c.unresolved, c.tag, c.attachment, ...groups.map((g) => `#${g.rgb.toString(16).padStart(6, "0")}`)];
    paletteAlpha = [1, 0.5, 1, 1, ...groups.map(() => 1)];
    const n = model.nodes.length;
    colorOf = new Int16Array(n);
    model.nodes.forEach((node, i) => {
      const g = node.kind === "note" || node.kind === "attachment" ? groups.findIndex((gr) => gr.match(node)) : -1;
      colorOf[i] = g >= 0 ? 4 + g : node.kind === "unresolved" ? 1 : node.kind === "tag" ? 2 : node.kind === "attachment" ? 3 : 0;
    });
    // Draw order: by colour, so each colour is one path.
    order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => colorOf[a] - colorOf[b]);
  }

  function readColors(): Colors {
    const style = getComputedStyle(el);
    const v = (name: string) => style.getPropertyValue(name).trim();
    const read: Colors = {
      node: v("--graph-node"),
      unresolved: v("--graph-node-unresolved"),
      tag: v("--graph-node-tag"),
      attachment: v("--graph-node-attachment"),
      focused: v("--graph-node-focused"),
      highlight: v("--graph-node-highlight"),
      line: v("--graph-line"),
      lineHighlight: v("--graph-line-highlight"),
      text: v("--graph-text"),
      arrow: v("--graph-arrow"),
      font: style.fontFamily,
    };
    // Not in the document yet: nothing resolves, so read again next time.
    if (!read.node) return read;
    colors = read;
    if (palette.length) {
      palette[0] = colors.node;
      palette[1] = colors.unresolved;
      palette[2] = colors.tag;
      palette[3] = colors.attachment;
    }
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
    if (!drag && !pan && zoomAt === null && drawnModel === model && started - lastKey < TYPING_PAUSE) {
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
    if (scale !== targetScale) {
      const ease = duration("fast") <= 0 ? 1 : 1 - Math.pow(0.7, dt / 16);
      scale += (targetScale - scale) * ease;
      if (Math.abs(targetScale - scale) < targetScale * 1e-3) scale = targetScale;
      if (zoomAt) {
        offX = zoomAt.sx - width / 2 - zoomAt.wx * scale;
        offY = zoomAt.sy - height / 2 - zoomAt.wy * scale;
      }
      if (scale === targetScale) zoomAt = null;
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
    if (pointer && !drag && !pan && more) updateHover(pointer.x, pointer.y);
    // Settling on its own with a slow canvas: draw every other frame.
    const touched = !!drag?.moved || !!pan || zoomAt !== null || hoverFade !== want;
    if (!more || touched || lastCost < SLOW_FRAME || ++frameCount % 2 === 0) {
      const moving = more || touched;
      // WebKitGTK may not show a frame drawn right after the canvas was
      // resized until something else repaints: draw the next one too.
      if (setRatio(moving && fullCost > SLOW_FRAME ? Math.min(dpr, lowRatio) : dpr)) more = true;
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
    if (f === undefined || !width || !height) return;
    const { x, y } = sim;
    let reach = 0;
    for (let i = 0; i < model.nodes.length; i++) reach = Math.max(reach, Math.abs(x[i] - x[f]), Math.abs(y[i] - y[f]));
    const room = Math.max(40, Math.min(width / 2 - 50, height / 2 - 40));
    scale = targetScale = Math.max(MIN_SCALE, Math.min(cfg.scale, reach ? room / reach : cfg.scale));
    zoomAt = null;
    offX = -x[f] * scale;
    offY = -y[f] * scale;
  }

  function rememberLayout() {
    if (local || !ws.vault.path) return;
    const map = new Map<string, [number, number]>();
    model.nodes.forEach((n, i) => map.set(n.id, [sim.x[i], sim.y[i]]));
    layouts.set(ws.vault.path, map);
  }

  // ----- drawing -----

  function draw() {
    if (!width || !height) return;
    const c = colors ?? readColors();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = getBackground();
    ctx.fillRect(0, 0, width, height);
    const n = model.nodes.length;
    drawnModel = model;
    if (!n) return;
    const s = scale;
    const ns = Math.sqrt(s); // nodes and labels grow with the square root of the zoom
    const cx = width / 2 + offX;
    const cy = height / 2 + offY;
    const { x, y } = sim;
    const sizeMult = cfg.nodeSizeMultiplier;
    const hover = shownHover;
    const fade = hover >= 0 ? hoverFade : 0;
    const dim = 1 - (1 - DIM) * fade;
    const focus = focusId === null ? -1 : (model.index.get(focusId) ?? -1);
    // Off-screen culling margin, in screen pixels.
    const pad = 40;
    const sx = (i: number) => cx + x[i] * s;
    const sy = (i: number) => cy + y[i] * s;

    // Links: one stroke for all of them, or dimmed ones and highlighted ones.
    // One device pixel on a dense screen at the default thickness (see the top).
    const lw = Math.max(0.3, cfg.lineSizeMultiplier * ns);
    ctx.lineWidth = ratio > 1 && lw <= 1.05 ? 1 / ratio : lw;
    const links = model.links;
    const pathLinks = (want: (touches: boolean) => boolean) => {
      ctx.beginPath();
      for (let k = 0; k < links.length; k++) {
        const a = links[k].source;
        const b = links[k].target;
        const touches = hover >= 0 && (a === hover || b === hover);
        if (!want(touches)) continue;
        const x1 = sx(a);
        const y1 = sy(a);
        const x2 = sx(b);
        const y2 = sy(b);
        if ((x1 < -pad && x2 < -pad) || (x1 > width + pad && x2 > width + pad) || (y1 < -pad && y2 < -pad) || (y1 > height + pad && y2 > height + pad)) continue;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
    };
    ctx.strokeStyle = c.line;
    ctx.globalAlpha = hover >= 0 ? dim : 1;
    pathLinks((touches) => hover < 0 || !touches || fade < 1);
    ctx.stroke();
    if (hover >= 0) {
      ctx.globalAlpha = fade;
      ctx.strokeStyle = c.lineHighlight;
      pathLinks((touches) => touches);
      ctx.stroke();
    }

    if (cfg.showArrow) {
      ctx.fillStyle = c.arrow;
      const size = Math.max(3, 6 * lw);
      const arrowTo = (from: number, to: number) => {
        const x2 = sx(to);
        const y2 = sy(to);
        if (x2 < -pad || x2 > width + pad || y2 < -pad || y2 > height + pad) return;
        const dx = x2 - sx(from);
        const dy = y2 - sy(from);
        const len = Math.hypot(dx, dy);
        const r = radius[to] * sizeMult * ns;
        if (len <= r + size) return;
        const ux = dx / len;
        const uy = dy / len;
        const tipX = x2 - ux * r;
        const tipY = y2 - uy * r;
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ux * size - uy * size * 0.5, tipY - uy * size + ux * size * 0.5);
        ctx.lineTo(tipX - ux * size + uy * size * 0.5, tipY - uy * size - ux * size * 0.5);
        ctx.closePath();
      };
      ctx.globalAlpha = 0.5 * (hover >= 0 ? dim : 1);
      ctx.beginPath();
      for (const l of links) {
        arrowTo(l.source, l.target);
        if (l.both) arrowTo(l.target, l.source);
      }
      ctx.fill();
    }

    // Nodes, one path per colour and brightness.
    let pathColor = -1;
    let pathDim = -1;
    const flush = () => {
      if (pathColor < 0) return;
      ctx.fillStyle = palette[pathColor];
      ctx.globalAlpha = paletteAlpha[pathColor] * (pathDim ? dim : 1);
      ctx.fill();
    };
    for (let k = 0; k < n; k++) {
      const i = order[k];
      if (i === hover || i === focus) continue;
      const r = radius[i] * sizeMult * ns;
      const X = sx(i);
      const Y = sy(i);
      if (X < -r || X > width + r || Y < -r || Y > height + r) continue;
      const dimmed = hover >= 0 && !highlighted[i] ? 1 : 0;
      if (colorOf[i] !== pathColor || dimmed !== pathDim) {
        flush();
        pathColor = colorOf[i];
        pathDim = dimmed;
        ctx.beginPath();
      }
      ctx.moveTo(X + r, Y);
      ctx.arc(X, Y, r, 0, Math.PI * 2);
    }
    flush();
    // The current note: accent, with a ring.
    if (focus >= 0) {
      const r = radius[focus] * sizeMult * ns;
      const X = sx(focus);
      const Y = sy(focus);
      ctx.globalAlpha = hover >= 0 && !highlighted[focus] ? dim : 1;
      ctx.fillStyle = c.focused;
      ctx.beginPath();
      ctx.arc(X, Y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = c.focused;
      ctx.lineWidth = Math.max(1, 1.5 * ns);
      ctx.beginPath();
      ctx.arc(X, Y, r + Math.max(2, 3 * ns), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (hover >= 0) {
      const r = radius[hover] * sizeMult * ns;
      ctx.globalAlpha = 1;
      ctx.fillStyle = hover === focus ? c.focused : c.highlight;
      ctx.beginPath();
      ctx.arc(sx(hover), sy(hover), r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Labels fade in with the zoom: none below 50%, all from 100% (the
    // text fade threshold shifts that), and the hovered node's always. A
    // local graph zoomed out only to fit its neighbourhood keeps them.
    const textAlpha = follow ? 1 : Math.max(0, Math.min(1, Math.log2(s) + 1 - cfg.textFadeMultiplier));
    const fontSize = LABEL_SIZE * (follow ? Math.max(ns, 0.75) : ns);
    ctx.font = `${fontSize}px ${c.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = c.text;
    if (textAlpha > 0.01) {
      let current = -1;
      for (let i = 0; i < n; i++) {
        if (i === hover) continue;
        const X = sx(i);
        const Y = sy(i);
        if (X < -300 || X > width + 300 || Y < -fontSize * 2 || Y > height + 10) continue;
        const a = textAlpha * (hover >= 0 && !highlighted[i] ? dim : 1);
        if (a < 0.01) continue;
        if (a !== current) ctx.globalAlpha = current = a;
        ctx.fillText(model.nodes[i].label, X, Y + radius[i] * sizeMult * ns + 4);
      }
    }
    if (hover >= 0) {
      ctx.globalAlpha = Math.max(textAlpha, fade);
      const shift = 8 * fade * ns;
      ctx.fillText(model.nodes[hover].label, sx(hover), sy(hover) + radius[hover] * sizeMult * ns + 4 + shift);
    }
    ctx.globalAlpha = 1;
  }

  let background = "";
  const getBackground = () => background || (el.isConnected ? (background = getComputedStyle(el).backgroundColor) : "#fff");

  // ----- hit testing and hover -----

  /** The node under a point (canvas pixels), or -1: one pass over the nodes, nearest wins. */
  function nodeAt(px: number, py: number): number {
    const s = scale;
    const ns = Math.sqrt(s);
    const cx = width / 2 + offX;
    const cy = height / 2 + offY;
    const wx = (px - cx) / s;
    const wy = (py - cy) / s;
    const mult = cfg.nodeSizeMultiplier * ns;
    let best = -1;
    let bestD = Infinity;
    const { x, y } = sim;
    for (let i = 0; i < model.nodes.length; i++) {
      const r = (radius[i] * mult + 2) / s; // world units, with 2px to spare
      const dx = x[i] - wx;
      const dy = y[i] - wy;
      const d = dx * dx + dy * dy;
      if (d <= r * r && d < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }

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

  function updateHover(px: number, py: number) {
    setHover(nodeAt(px, py));
  }

  // ----- pointer -----

  let drag: { node: number; pointerId: number; startX: number; startY: number; moved: boolean; button: number } | null = null;
  let pan: { pointerId: number; x: number; y: number; startX: number; startY: number } | null = null;

  const local2 = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 1) e.preventDefault(); // no autoscroll
    if (e.button !== 0 && e.button !== 1) return;
    const p = local2(e);
    const node = nodeAt(p.x, p.y);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic event: moves still arrive while over the canvas
    }
    if (node >= 0) {
      drag = { node, pointerId: e.pointerId, startX: p.x, startY: p.y, moved: false, button: e.button };
      setHover(node);
    } else if (e.button === 0) {
      pan = { pointerId: e.pointerId, x: p.x, y: p.y, startX: p.x, startY: p.y };
      follow = false;
      el.classList.add("is-panning");
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = local2(e);
    pointer = p;
    if (drag && e.pointerId === drag.pointerId) {
      if (!drag.moved && Math.hypot(p.x - drag.startX, p.y - drag.startY) < CLICK_SLOP) return;
      if (!drag.moved) {
        drag.moved = true;
        sim.fixed[drag.node] = 1;
        sim.alphaTarget = 0.3;
        sim.reheat(0.3);
      }
      sim.x[drag.node] = (p.x - width / 2 - offX) / scale;
      sim.y[drag.node] = (p.y - height / 2 - offY) / scale;
      invalidate();
      return;
    }
    if (pan && e.pointerId === pan.pointerId) {
      offX += p.x - pan.x;
      offY += p.y - pan.y;
      pan.x = p.x;
      pan.y = p.y;
      zoomAt = null;
      invalidate();
      return;
    }
    // Hover: one cheap pass over the nodes; a frame is drawn only if it changed.
    updateHover(p.x, p.y);
  });

  const endPointer = (e: PointerEvent, cancelled: boolean) => {
    if (drag && e.pointerId === drag.pointerId) {
      const d = drag;
      drag = null;
      if (d.moved) {
        sim.fixed[d.node] = 0;
        sim.alphaTarget = 0;
        invalidate();
      } else if (!cancelled) {
        // A click: open the node (a middle click or Ctrl/Cmd in a new tab).
        const where: OpenWhere = d.button === 1 ? "tab" : whereFromEvent(e);
        openNode(model.nodes[d.node], where);
      }
    }
    if (pan && e.pointerId === pan.pointerId) {
      pan = null;
      el.classList.remove("is-panning");
      invalidate(); // the last frame at full resolution
    }
  };
  canvas.addEventListener("pointerup", (e) => endPointer(e, false));
  canvas.addEventListener("pointercancel", (e) => endPointer(e, true));
  canvas.addEventListener("pointerleave", () => {
    pointer = null;
    if (!drag) setHover(-1);
  });
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault();
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const p = local2(e);
    const i = nodeAt(p.x, p.y);
    const node = i >= 0 ? model.nodes[i] : null;
    if (node?.path && node.kind === "note") host.menu(node.path, { x: e.clientX, y: e.clientY });
  });

  function openNode(node: GraphNode | undefined, where: OpenWhere) {
    if (!node) return;
    if (node.kind === "tag") host.searchTag(node.label);
    else if (node.kind === "unresolved") host.openMissing(node.label, where);
    else if (node.path) host.open(node.path, where);
  }

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = local2(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * height : e.deltaY;
      // A pinch arrives as a wheel event with Ctrl held, in small steps.
      const factor = Math.exp(-delta * (e.ctrlKey ? PINCH_ZOOM : WHEEL_ZOOM));
      follow = false;
      targetScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, targetScale * factor));
      const cx = width / 2 + offX;
      const cy = height / 2 + offY;
      zoomAt = { sx: p.x, sy: p.y, wx: (p.x - cx) / scale, wy: (p.y - cy) / scale };
      saveScale();
      invalidate();
    },
    { passive: false },
  );

  let scaleTimer = 0;
  const saveScale = () => {
    clearTimeout(scaleTimer);
    scaleTimer = window.setTimeout(() => setGraphSetting(local, "scale", Math.round(targetScale * 1e4) / 1e4), 500);
  };

  // ----- timelapse -----

  function startTimelapse() {
    const mtime = new Map(ws.files.map((f) => [f.path, f.mtime_ms]));
    const paths = ws.files.filter((f) => !f.is_dir).map((f) => f.path);
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
    if (w === width && hgt === height && device === dpr) return;
    width = w;
    height = hgt;
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
    canvas.width = Math.max(1, Math.round(width * r));
    canvas.height = Math.max(1, Math.round(height * r));
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

  let excluded = ws.isExcluded;
  const offSettings = settings.on((file) => {
    // Settings → Files and links → Excluded files: those notes leave the graph
    // (checked once the app has applied the change, whichever listener runs first).
    if (file === "app.json" || file === null) {
      queueMicrotask(() => {
        if (ws.isExcluded === excluded || disposed) return;
        excluded = ws.isExcluded;
        scheduleRebuild(0);
      });
    }
    if (file !== "graph.json" && file !== null) return;
    const before = cfg;
    cfg = graphSettings(local);
    panel.sync();
    const forcesChanged =
      before.centerStrength !== cfg.centerStrength ||
      before.repelStrength !== cfg.repelStrength ||
      before.linkStrength !== cfg.linkStrength ||
      before.linkDistance !== cfg.linkDistance;
    applyForces();
    if (forcesChanged) {
      sim.reheat(0.3);
      sim.alphaTarget = 0;
    }
    const dataKeys: (keyof GraphSettings)[] = ["search", "showTags", "showAttachments", "hideUnresolved", "showOrphans", "colorGroups", "localJumps", "localBacklinks", "localForelinks", "localInterlinks"];
    if (dataKeys.some((k) => JSON.stringify(before[k]) !== JSON.stringify(cfg[k]))) {
      if (before.showTags !== cfg.showTags) tagCache = null;
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
      tagCache = null;
      textCache.clear();
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
  (window as any).__graphRatio = (r: number) => { setRatio(r); draw(); };
  // For the measuring harness (dev builds): a node's and an empty spot's client coordinates.
  const probe = () => {
    const rect = canvas.getBoundingClientRect();
    const at = (i: number) => [rect.left + width / 2 + offX + sim.x[i] * scale, rect.top + height / 2 + offY + sim.y[i] * scale];
    // The most linked node on screen (clear of the settings panel).
    let best = -1;
    for (let i = 0; i < model.nodes.length; i++) {
      const [cx, cy] = at(i);
      if (cx < rect.left + 60 || cx > rect.right - 300 || cy < rect.top + 60 || cy > rect.bottom - 60) continue;
      if (best < 0 || model.nodes[i].weight > model.nodes[best].weight) best = i;
    }
    let empty: number[] | null = null;
    for (let gy = 40; gy < height - 40 && !empty; gy += 20) {
      for (let gx = 40; gx < width - 300 && !empty; gx += 20) if (nodeAt(gx, gy) < 0) empty = [rect.left + gx, rect.top + gy];
    }
    return { node: best >= 0 ? at(best) : null, empty, scale, nodes: model.nodes.length, links: model.links.length };
  };
  // The current note: the local graph's middle, or the note last shown in the global graph's place.
  focusId = local ? (host.file?.() ?? null) : (ws.active.path ?? ws.recent[0] ?? null);

  return {
    el,
    setActive(next) {
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
      if (import.meta.env.DEV) (window as unknown as { __graphProbe?: () => unknown }).__graphProbe = probe;
      resize.observe(el);
      colors = null;
      background = "";
      measure();
      if (stale || !built) void rebuild();
      invalidate();
    },
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
