// Plain DOM/SVG board. Detached, read-only editor contexts reuse Reading's
// renderer and local embeds; embedded note editors use the shared note save path.
import { markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { api } from "../api";
import { fileSave } from "../fileSave";
import { commands } from "../commands";
import { IMAGE_EXT, embedPart } from "../editor/embeds";
import { editorHost } from "../editor/host";
import { readingMode, release, render } from "../editor/render";
import { isExternalUrl, isNotePath } from "../links/external";
import { resolveLink } from "../links/internal";
import { isDrawingPath, openDrawingImages, renderDrawing } from "../drawing/render";
import { parseScene } from "../drawing/scene";
import { isNoteFile, noteName } from "../paths";
import { h } from "../shell/dom";
import { settings } from "../settings/store";
import type { Group, Tab } from "../tabs";
import { whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { canvasReadOnly } from "./controls";
import { canvasCards, editTextCard } from "./cards";
import { canvasNavigation } from "./navigation";
import { editCanvas } from "./document";
import { canvasEditing } from "./editing";
import { spaceCardBody } from "./spacing";
import { groupBackground } from "./groups";
import { editNoteCard } from "./note";
import { editCanvasLabel } from "./labels";
import { canvasTitle, edgeCurve, readCanvas, type CanvasEdge, type CanvasNode } from "./model";
import { attachPresentation, registerPresentation } from "./presentSession";
import type { Guide } from "./align";
import { canvasWork } from "./work";
import { canvasBodies } from "./bodies";
import { linkFrameBody } from "./linkFrame";
import { canvasEdges } from "./edges";
import { holdCanvasWrite, trackCanvas } from "./pending";

const NS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>, ...children: SVGElement[]) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}
function arrowMarker(id: string, fill: string) {
  return svg("marker", { id, viewBox: "0 0 10 10", refX: "10", refY: "5", markerWidth: "10", markerHeight: "10", markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" },
    svg("path", { d: "M0,0 L10,5 L0,10 Z", fill, stroke: fill, "stroke-width": "2" }));
}
const presets = ["red", "orange", "yellow", "green", "cyan", "purple"];
function color(value?: string) {
  return value && /^[1-6]$/.test(value) ? `var(--color-${presets[Number(value) - 1]})` : value && CSS.supports("color", value) ? value : "var(--background-modifier-border-focus)";
}
// Hide block metadata in the displayed copy, retaining literal IDs in code.
function withoutBlockIds(text: string) {
  if (!text.includes("^")) return text;
  const tree = markdownLanguage.parser.parse(text);
  return text.replace(/(?:^|[ \t]+)\^[a-zA-Z0-9-]+[ \t]*$/gm, (mark, at: number) => {
    for (let node = tree.resolveInner(at + mark.indexOf("^"), 1); node; node = node.parent!) {
      if (["FencedCode", "CodeBlock", "InlineCode", "HTMLBlock"].includes(node.name)) return mark;
    }
    return "";
  });
}
export function createCanvasView(ws: Workspace, path: string, group: Group, tab: Tab) {
  const host = ws.editors.viewOf(group).state.facet(editorHost)!;
  const world = h("div", { class: "canvas-world" });
  const el = h("div", { class: "view-content canvas-view", "aria-label": "Canvas", tabindex: "0" }, world);
  let gone = false, generation = 0, loading = 0, source = "", notifying = false;
  let undo: string[] = [], redo: string[] = [];
  let stopText: ((paint?: boolean) => void) | undefined;
  let selectAfterDraw: string | undefined, editAfterDraw: string | undefined, building = false, cancelAutoEdit = 0;
  const disk = fileSave({
    delay: 300,
    text: () => source,
    write: async (text) => {
      await api.writeNote(path, text);
      // Our own save. Mark it before anyone hears, including when a newer edit arrived mid-write.
      notifying = true;
      try { ws.vault.written(path); } finally { notifying = false; }
    },
    onError(err) { console.error(`Could not save ${path}`, err); },
  });
  function save() { return holdCanvasWrite(path, disk.flush().then(() => {})); }
  function changed(next: string, redraw = false) {
    if (next === source) return;
    source = next;
    navigation.updateHistory(undo.some(text => text !== source), redo.some(text => text !== source));
    disk.touch();
    if (redraw) draw();
  }
  function history(forward: boolean) {
    if (canvasReadOnly.has(el)) return;
    stopText?.();
    const from = forward ? redo : undo, to = forward ? undo : redo;
    let next = from.pop();
    while (next === source) next = from.pop();
    if (next === undefined) return;
    to.push(source); changed(next, true); el.focus({ preventScroll: true });
  }
  let refreshFrames = () => {};
  const stopEmbeds = settings.on((file, key) => {
    if (file !== null && file !== "app.json") return;
    if (key !== null && key !== "webEmbeds") return;
    refreshFrames();
  });
  let cleanups: (() => void)[] = [];
  let live: { nodes: CanvasNode[]; edges: CanvasEdge[]; present(ids: readonly string[]): void } | null = null;
  let presentation: { start(): void; stop(restore?: boolean): void; dispose(): void } = { start() {}, stop() {}, dispose() {} };
  const clear = () => { presentation.stop(false); live = null; refreshFrames = () => {}; cardActions.reset(); stopText?.(false); cleanups.splice(0).reverse().forEach(fn => fn()); world.replaceChildren(); };
  const navigation = canvasNavigation(el, world, tab, path, history, () => draw(), () => presentation.start());
  const cardActions = canvasCards(el, world, ws, path, (node, edge) => {
    if (gone || canvasReadOnly.has(el)) return;
    stopText?.();
    const nodes = Array.isArray(node) ? node : [node];
    if (!nodes.length) return;
    undo.push(source); redo = [];
    selectAfterDraw = nodes[0].id; editAfterDraw = nodes.length === 1 && nodes[0].type === "text" && !nodes[0].text ? nodes[0].id : undefined;
    changed(editCanvas(source, [], undefined, nodes, edge ? [edge] : []), true);
    if (!(nodes.length === 1 && nodes[0].type === "text" && !nodes[0].text)) el.focus({ preventScroll: true });
  });
  const selected = () => [...el.querySelectorAll<HTMLElement>(".canvas-node.is-selected")].flatMap(node => node.dataset.nodeId ? [node.dataset.nodeId] : []);
  presentation = attachPresentation({
    el,
    nodes: () => live?.nodes ?? [],
    edges: () => live?.edges ?? [],
    selected,
    reveal: ids => live?.present(ids),
    clearReveal: () => live?.present([]),
    camera: () => navigation.camera(),
    reflow: () => navigation.reflow(),
    jump: camera => navigation.jump(camera),
    glide: (camera, ms) => navigation.glide(camera, ms),
    cancelGlide: () => navigation.cancelGlide(),
    hold: value => navigation.hold(value),
    onHeldResize: fn => navigation.onHeldResize(fn),
    stopEditing: () => stopText?.(false),
    keysBlocked: () => commands.suspended(),
  });
  const unregisterPresentation = registerPresentation(el, () => presentation.start());
  const openBoardMenu = (x: number, y: number) => cardActions.boardMenu(x, y, {
    undo: undo.some(text => text !== source),
    redo: redo.some(text => text !== source),
    apply: history,
  }, () => draw());
  const openCreateMenu = (box: { x: number; y: number; width: number; height: number }, at: { x: number; y: number }) =>
    cardActions.createMenu({ ...box, atStart: true }, at);
  async function load() {
    const mine = ++loading;
    let text: string;
    try { text = await api.readNote(path); } catch { text = ""; }
    if (gone || mine !== loading) return;
    if (text === source && world.childElementCount) return;
    disk.drop();
    source = text; undo = []; redo = [];
    draw();
  }
  async function draw() {
    clear();
    const mine = ++generation; building = true;
    const selectedId = selectAfterDraw, editId = editAfterDraw;
    selectAfterDraw = editAfterDraw = undefined;
    let startEditor: (() => void) | undefined;
    const { nodes, edges } = readCanvas(source);
    const bounds = boundsOf();
    const work = canvasWork(), bodies = canvasBodies(nodes, work, () => navigation.snapshot());
    refreshFrames = () => { if (!gone && mine === generation) bodies.recheck(); };
    let built = false;
    const contexts = new Map<string, { view: EditorView; refs: number }>();
    const hosts = new Map<string, typeof host>();
    cleanups.push(() => { work.dispose(); bodies.dispose(); for (const context of contexts.values()) context.view.destroy(); contexts.clear(); });
    navigation.loaded(bounds);
    const drawing = svg("svg", { class: "canvas-edges", overflow: "visible" });
    // Alignment guides while a card is dragged: lines in board units, dots sized for the zoom.
    const guideLayer = svg("svg", { class: "canvas-guides", overflow: "visible" });
    world.append(drawing, guideLayer);
    const showGuides = (guides: Guide[], radius: number) => guideLayer.replaceChildren(...guides.flatMap(g => {
      const point = (along: number) => g.axis === "y" ? [along, g.at] : [g.at, along];
      const [x1, y1] = point(g.from), [x2, y2] = point(g.to);
      return [svg("line", { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) }),
        ...g.dots.map(dot => { const [cx, cy] = point(dot); return svg("circle", { cx: String(cx), cy: String(cy), r: String(radius) }); })];
    }));
    const edits = new Map<string, (line?: number, refresh?: () => void) => void>();
    const backgrounds = new Map<string, () => void>();
    const byId = new Map(nodes.map(n => [n.id, n]));
    const edgeDrawing = canvasEdges(world, drawing, edges, byId, work, color);
    cleanups.push(() => edgeDrawing.dispose());
    navigation.watch(() => {
      if (gone || mine !== generation) return;
      const view = navigation.snapshot(); if (!view) return;
      bodies.update(); edgeDrawing.mode(view.titles, view.band, view);
      if (built) work.resume();
    }, () => work.pause());
    let chunk = performance.now();
    const shells = document.createDocumentFragment(), shellCards = new Map<string, HTMLElement>();
    let earlyEditor: HTMLElement | undefined;
    const preview = svg("path", { fill: "none", "stroke-width": "2" });
    const previewArrow = arrowMarker(`canvas-preview-${group.id}-${mine}`, color());
    const previewGroup = svg("g", { class: "canvas-edge-preview" }, previewArrow, preview);
    previewGroup.style.display = "none"; drawing.append(previewGroup);
    function previewEdge(edge?: CanvasEdge, free?: { end: "from" | "to"; x: number; y: number }) {
      previewGroup.style.display = edge ? "" : "none";
      if (!edge) return;
      const a = byId.get(edge.fromNode)!, b = byId.get(edge.toNode)!;
      const point = free ? { ...a, x: free.x, y: free.y, width: 0, height: 0 } : null;
      preview.setAttribute("d", edgeCurve(free?.end === "from" ? point! : a, free?.end === "to" ? point! : b, edge).path);
      preview.setAttribute("stroke", color(edge.color));
      for (const key of ["fill", "stroke"]) previewArrow.firstElementChild!.setAttribute(key, color(edge.color));
      preview.setAttribute("marker-start", edge.fromEnd === "arrow" ? `url(#${previewArrow.id})` : "none");
      preview.setAttribute("marker-end", edge.toEnd !== "none" ? `url(#${previewArrow.id})` : "none");
    }
    const buildOrder = editId ? [...nodes.filter(n => n.id === editId), ...nodes.filter(n => n.id !== editId)] : nodes;
    for (const node of buildOrder) {
      if (performance.now() - chunk > 4) {
        await new Promise<void>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(null); });
        if (gone || mine !== generation) return;
        chunk = performance.now();
      }
      const card = h("div", { class: `canvas-node canvas-node-${node.type}`, "data-node-id": node.id });
      // Hover resolves links from this note, or from the canvas file for a text card.
      if (node.type === "text") card.dataset.path = path;
      else if (node.type === "file" && isNoteFile(node.file ?? "")) card.dataset.path = node.file!;
      Object.assign(card.style, { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` });
      if (node.color) card.classList.add("is-colored");
      card.style.setProperty("--canvas-color", color(node.color));
      // The zoom bands size this ring, not the card, so a band change never restyles a card.
      card.append(h("div", { class: "canvas-node-ring" }));
      shells.append(card); shellCards.set(node.id, card);
      let refreshFile = () => {};
      if (node.type === "group") {
        const backdrop = h("div", { class: "canvas-group-background" }); card.append(backdrop);
        let held: ReturnType<typeof ws.embeds.image> | undefined, heldPath: string | undefined;
        let unwatchBackground = () => {};
        const background = () => {
          backdrop.style.backgroundSize = node.backgroundStyle === "repeat" ? "auto" : "cover";
          backdrop.style.backgroundRepeat = node.backgroundStyle === "repeat" ? "repeat" : "no-repeat";
          const file = ws.vault.files.find(f => f.path === node.background && !f.is_dir && IMAGE_EXT.test(f.path));
          if (heldPath === file?.path) return;
          unwatchBackground(); held?.release(); held = undefined; heldPath = file?.path; backdrop.style.backgroundImage = "";
          if (!file) return;
          unwatchBackground = ws.embeds.watch(file.path, () => queueMicrotask(() => { if (!gone && mine === generation) { heldPath = undefined; background(); } }));
          const current = held = ws.embeds.image(file.path);
          void current.url.then(url => { if (!gone && mine === generation && held === current) backdrop.style.backgroundImage = `url(${JSON.stringify(url)})`; }, () => {});
        };
        backgrounds.set(node.id, background); background(); cleanups.push(() => { unwatchBackground(); held?.release(); });
        const label = h("div", { class: "canvas-group-label", "aria-label": "Group label" }, node.label ?? ""); card.append(label);
        const edit = (_line?: number, refresh?: () => void) => {
          if (canvasReadOnly.has(el) || card.classList.contains("is-editing")) return;
          stopText?.(); card.classList.add("is-editing");
          stopText = editCanvasLabel(label, (value, save) => {
            stopText = undefined; card.classList.remove("is-editing");
            if (save && value !== node.label) { node.label = value; undo.push(source); redo = []; changed(editCanvas(source, [node])); }
            if (save) { label.textContent = node.label ?? ""; refresh?.(); }
          });
        };
        edits.set(node.id, edit); if (node.id === editId) startEditor = edit;
        bodies.add(node, card);
        continue;
      }
      if (node.type === "file" || node.type === "link") card.append(h("div", { class: "canvas-file-label" }, node.type === "link" ? node.url ?? "" : canvasTitle(node)));
      const content = h("div", { class: "canvas-node-content markdown-rendered is-reading-mode" });
      card.append(content);
      // Title mode shows an image itself; every other card shows this instead of its body.
      const image = node.type === "file" && IMAGE_EXT.test(node.file ?? "");
      const title = h("div", { class: "canvas-node-title" }, image ? "" : canvasTitle(node));
      if (image) card.classList.add("is-image"); else card.append(title);
      if (node.type === "link") {
        bodies.add(node, card, linkFrameBody(node, content, {
          slotted: id => bodies.slotted(id),
          ready: item => bodies.ready(item),
          recheck: id => bodies.recheck(id),
        }));
        continue;
      }
      if (image) {
        const img = h("img", { alt: node.file ?? "" });
        content.append(img);
        let held: ReturnType<typeof ws.embeds.image> | undefined;
        refreshFile = () => {
          held?.release(); const current = held = ws.embeds.image(node.file!);
          void current.url.then(url => { if (!gone && mine === generation && held === current) img.src = url; }, () => { if (!gone && mine === generation && held === current) img.removeAttribute("src"); });
        };
        let unwatchImage = () => {};
        const drop = () => { unwatchImage(); unwatchImage = () => {}; held?.release(); held = undefined; img.removeAttribute("src"); };
        bodies.add(node, card, { element: content, ensure() { if (!held) { unwatchImage = ws.embeds.watch(node.file!, () => work.add(img, () => { if (bodies.wanted(node)) refreshFile(); else drop(); })); refreshFile(); } }, release: drop, ready: () => !!held });
        cleanups.push(drop);
        continue;
      }
      if (node.type === "file" && node.file && isDrawingPath(node.file)) {
        const file = node.file;
        card.classList.add("is-drawing");
        const preview = h("div", { class: "drawing-preview" });
        content.append(preview);
        let images: ReturnType<typeof openDrawingImages> | null = null;
        let text = "";
        let dark = document.documentElement.classList.contains("theme-dark");
        let requested = false;
        let painted = false;
        let request = 0;
        let unwatch = () => {};
        const theme = new MutationObserver(() => {
          const next = document.documentElement.classList.contains("theme-dark");
          if (next === dark) return;
          dark = next;
          if (text && painted && preview.dataset.failed !== "1") paint();
        });
        const drop = () => {
          request++;
          requested = false;
          painted = false;
          unwatch();
          unwatch = () => {};
          theme.disconnect();
          images?.revoke();
          images = null;
          text = "";
          preview.replaceChildren();
          delete preview.dataset.failed;
        };
        function paint() {
          images?.revoke();
          images = null;
          const parsed = parseScene(text);
          if (!parsed.ok) {
            preview.replaceChildren();
            preview.textContent = parsed.error;
            preview.dataset.failed = "1";
            painted = true;
            bodies.ready(node);
            return;
          }
          delete preview.dataset.failed;
          images = openDrawingImages(parsed.scene);
          preview.innerHTML = renderDrawing(parsed.scene, {
            dark,
            images: (id) => images?.href(id),
            idPrefix: `card${node.id}`,
            paper: true,
          }).markup;
          painted = true;
          bodies.ready(node);
        }
        function ensure() {
          if (requested || painted) return;
          requested = true;
          const token = ++request;
          theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
          unwatch = ws.embeds.watch(file, () => queueMicrotask(() => {
            if (gone || mine !== generation) return;
            if (!bodies.wanted(node)) { drop(); return; }
            drop();
            ensure();
          }));
          void ws.embeds.read(file).then((next) => work.add(preview, () => {
            if (gone || mine !== generation || token !== request) return;
            text = next;
            if (bodies.wanted(node)) paint();
            else drop();
          }), () => work.add(preview, () => {
            if (gone || mine !== generation || token !== request) return;
            requested = false;
            painted = true;
            preview.textContent = `File not found: ${file}`;
            preview.dataset.failed = "1";
            bodies.ready(node);
          }));
        }
        card.addEventListener("dblclick", (event) => {
          if (!event.isTrusted || world.classList.contains("is-zoomed-out")) return;
          if ((event.target as Element).closest(".canvas-node-resizer, .canvas-node-connection-point")) return;
          event.stopPropagation();
          void ws.open(file, { where: whereFromEvent(event), group });
        });
        bodies.add(node, card, { element: content, ensure, release: drop, ready: () => painted });
        cleanups.push(drop);
        continue;
      }
      if (node.type === "file" && !isNoteFile(node.file ?? "")) {
        bodies.add(node, card, { element: content, ensure() { content.textContent = node.file ? `Unsupported file: ${node.file}` : "File not found"; }, release() { content.replaceChildren(); }, ready: () => !!content.textContent });
        continue;
      }
      const origin = node.type === "file" ? node.file! : path;
      const resolve = (href: string) => resolveLink(href, origin, ws.vault.fileRefs());
      const cardHost = hosts.get(origin) ?? {
        ...host, contextMenu: undefined, properties: undefined,
        formatLink: (target: string, _view: EditorView, display?: string, subpath?: string) => ws.linkTo(target, origin, display, subpath),
        linkExists: (href: string) => !!resolve(href),
        openLink: (href: string, where: false | "tab" | "right") => {
          const hash = href.indexOf("#"), name = hash < 0 ? href : href.slice(0, hash);
          void ws.openLink(`${name ? resolve(name) ?? name : origin}${hash < 0 ? "" : href.slice(hash)}`, where, group);
        },
        embeds: { ...ws.embeds, pathOf: () => origin, resolve: (href: string) => resolve(href), toggleTask: () => {} },
      };
      hosts.set(origin, cardHost);
      let context: { view: EditorView; refs: number } | undefined;
      const contextView = () => {
        if (!context) {
          context = contexts.get(origin);
          if (!context) { context = { view: new EditorView({ state: EditorState.create({ extensions: [EditorState.readOnly.of(true), readingMode.of(true), editorHost.of(cardHost)] }) }), refs: 0 }; contexts.set(origin, context); }
          context.refs++;
        }
        return context.view;
      };
      content.addEventListener("click", event => {
        const link = (event.target as Element).closest<HTMLElement>("[data-href]");
        if (!event.isTrusted || !link || card.classList.contains("is-editing")) return;
        event.preventDefault();
        const href = link.dataset.href!;
        if (isNotePath(href) || href.startsWith("#")) cardHost.openLink(href, whereFromEvent(event));
        else if (isExternalUrl(href)) void api.openExternal(href).catch(console.warn);
      });
      let painted: ReturnType<typeof render> | undefined, prepared = false;
      let requested = false, request = 0, unwatch = () => {};
      const drop = () => {
        request++; requested = false; prepared = false; unwatch(); unwatch = () => {};
        if (painted) { release(painted); painted = undefined; }
        if (context && --context.refs === 0) { context.view.destroy(); contexts.delete(origin); }
        context = undefined;
        if (content.firstChild && !card.classList.contains("is-editing")) content.replaceChildren();
      };
      cleanups.push(drop);
      const paint = (source: string) => {
        if (gone || mine !== generation || card.classList.contains("is-editing")) return;
        if (painted) { release(painted); painted = undefined; }
        const shown = embedPart(source, node.type === "file" ? node.subpath?.replace(/^#/, "") ?? "" : "");
        if (!shown) { content.textContent = `Unable to find “${node.subpath}” in “${node.file}”.`; prepared = true; bodies.ready(node); return; }
        content.replaceChildren(); content.classList.add("is-reading-mode");
        painted = render(content, node.type === "file" ? withoutBlockIds(shown.text) : shown.text, contextView(), [origin], () => {});
        spaceCardBody(content, painted.state);
        if (node.type === "file") content.prepend(h("div", { class: "canvas-note-title" }, noteName(node.file!)));
        content.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => input.disabled = true);
        prepared = true; bodies.ready(node);
      };
      if (node.type === "text") {
        const edit = () => {
          if (canvasReadOnly.has(el) || card.classList.contains("is-editing")) return;
          stopText?.();
          if (content.parentElement !== card) card.append(content);
          if (painted) { release(painted); painted = undefined; }
          let checkpoint = false;
          stopText = editTextCard(card, content, node.text ?? "", cardHost, text => {
            if (!checkpoint) { undo.push(source); redo = []; checkpoint = true; }
            node.text = text; changed(editCanvas(source, [node]));
          }, repaint => { stopText = undefined; title.textContent = canvasTitle(node); if (repaint) paint(node.text ?? ""); });
        };
        edits.set(node.id, edit);
        card.addEventListener("dblclick", event => {
          if (!event.isTrusted || (event.target as Element).closest("a, [data-href], input, .cm-editor, .canvas-node-resizer, .canvas-node-connection-point")) return;
          event.stopPropagation(); edit();
        });
        if (node.id === editId) startEditor = edit;
      }
      else {
        const edit = (line = 1) => {
          if (canvasReadOnly.has(el) || card.classList.contains("is-editing")) return;
          stopText?.();
          if (content.parentElement !== card) card.append(content);
          if (painted) { release(painted); painted = undefined; }
          stopText = editNoteCard(card, content, ws, group, origin, node.subpath, line, repaint => {
            stopText = undefined; if (repaint) refreshFile();
          });
        };
        edits.set(node.id, edit);
        card.addEventListener("dblclick", event => {
          if (!event.isTrusted || (event.target as Element).closest("a, [data-href], input, .cm-editor, .canvas-note-title, .canvas-node-resizer, .canvas-node-connection-point")) return;
          const line = Number((event.target as Element).closest<HTMLElement>("[data-line]")?.dataset.line) || 1;
          event.stopPropagation(); edit(line);
        });
        refreshFile = () => {
          if (card.classList.contains("is-editing")) return;
          drop(); if (bodies.wanted(node)) ensure();
        };
      }
      const ensure = () => {
        if (prepared || requested || card.classList.contains("is-editing")) return;
        requested = true;
        if (node.type === "text") { paint(node.text ?? ""); return; }
        const token = ++request;
        unwatch = ws.embeds.watch(origin, () => queueMicrotask(() => { if (!gone && mine === generation) refreshFile(); }));
        void ws.embeds.read(origin).then(text => work.add(content, () => {
          if (gone || mine !== generation || token !== request) return;
          requested = false;
          if (bodies.wanted(node)) paint(text); else drop();
        }), () => work.add(content, () => {
          if (!gone && mine === generation && token === request) { requested = false; prepared = true; content.textContent = `File not found: ${origin}`; bodies.ready(node); }
        }));
      };
      bodies.add(node, card, { element: content, ensure, release: drop, ready: () => prepared });
      if (node.id === editId && startEditor && cancelAutoEdit !== mine) { earlyEditor = card; world.append(card); bodies.update(); startEditor(); startEditor = undefined; }
    }
    // Construct off-DOM, then expose bounded chunks across rendering frames.
    // fonts.ready is read only by the few lazily acquired shared contexts.
    for (let i = 0; i < nodes.length; i += 512) {
      const fragment = document.createDocumentFragment();
      for (const node of nodes.slice(i, i + 512)) { bodies.prepare(node); const card = shellCards.get(node.id)!; if (card.parentNode === shells) fragment.append(card); }
      world.insertBefore(fragment, earlyEditor?.parentNode === world ? earlyEditor : null);
      if (nodes.length > 512) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (gone || mine !== generation) return;
    }
    const cards = shellCards;
    cleanups.push(canvasEditing(el, world, nodes, edges, changed => {
      const ids = new Set(changed.map(n => n.id));
      for (const n of changed) {
        const card = cards.get(n.id)!;
        Object.assign(card.style, { left: `${n.x}px`, top: `${n.y}px`, width: `${n.width}px`, height: `${n.height}px` });
        card.classList.toggle("is-colored", !!n.color); card.style.setProperty("--canvas-color", color(n.color)); backgrounds.get(n.id)?.();
      }
      bodies.changed(changed); edgeDrawing.changed(ids);
      navigation.loaded(boundsOf());
    }, (nodes, deleted, changedEdges, deletedEdges, added = []) => {
      const next = editCanvas(source, nodes, deleted, added, changedEdges, deletedEdges);
      if (next === source) return;
      undo.push(source); redo = [];
      if (nodes.length) edgeDrawing.settle();
      for (const edge of changedEdges ?? []) {
        const existing = edges.find(item => item.id === edge.id);
        if (existing) Object.assign(existing, edge); else edges.push(edge);
        edgeDrawing.update(existing ?? edge);
      }
      if (added.length) { selectAfterDraw = added[0].id; editAfterDraw = added[0].id; }
      changed(next, !!deleted?.size || !!deletedEdges?.size || !!added.length);
    }, previewEdge, cardActions.connect, history, nodes => navigation.zoomTo(nodes), (item, refresh) => {
      if (!("fromNode" in item)) { edits.get(item.id)?.(undefined, refresh); return; }
      if (canvasReadOnly.has(el)) return;
      const record = edgeDrawing.get(item.id); if (!record) return;
      if (record.label?.classList.contains("is-editing")) return;
      stopText?.();
      const label = record.label ?? h("div", { class: "canvas-edge-label", "data-edge-id": item.id });
      record.label = label; world.append(label); edgeDrawing.place(record);
      label.textContent = item.label ?? "";
      label.setAttribute("aria-label", "Edge label");
      stopText = editCanvasLabel(label, (value, save) => {
        stopText = undefined;
        if (save) {
          if (value !== item.label) {
            item.label = value; undo.push(source); redo = [];
            changed(editCanvas(source, [], undefined, [], [item]));
          }
          edgeDrawing.update(item); refresh();
        }
      });
    }, selectedId, (node, anchor, apply) => groupBackground(ws, node, anchor, apply, () => !gone && mine === generation && !canvasReadOnly.has(el)), showGuides, openBoardMenu, openCreateMenu, ids => edgeDrawing.select(ids)));
    live = { nodes, edges, present: ids => bodies.present(ids) };
    built = true; building = false;
    const view = navigation.snapshot(); if (view) { bodies.update(); edgeDrawing.mode(view.titles, view.band, view); }
    work.resume();
    if (import.meta.env.DEV) {
      const dev = window as unknown as { __canvasProbe?: () => unknown }, probe = () => ({ contexts: contexts.size, ...bodies.stats(), ...work.stats(), built });
      dev.__canvasProbe = probe; cleanups.push(() => { if (dev.__canvasProbe === probe) delete dev.__canvasProbe; });
    }
    if (cancelAutoEdit !== mine) startEditor?.();
    function boundsOf() { return nodes.length ? { left: Math.min(...nodes.map(n => n.x)), top: Math.min(...nodes.map(n => n.y)), right: Math.max(...nodes.map(n => n.x + n.width)), bottom: Math.max(...nodes.map(n => n.y + n.height)) } : { left: 0, top: 0, right: 0, bottom: 0 }; }
    navigation.loaded(bounds);
    navigation.updateHistory(undo.some(text => text !== source), redo.some(text => text !== source));
  }
  // Large-board construction yields, but Escape/board Undo must not disappear
  // into that interval. A new empty card's editor is installed before yielding.
  el.addEventListener("keydown", event => {
    if (!building || (event.target as Element).closest(".cm-editor,input,textarea,[contenteditable=true]")) return;
    if (event.key === "Escape") { cancelAutoEdit = generation; event.preventDefault(); event.stopPropagation(); }
    else if ((event.ctrlKey || event.metaKey) && ["z","y"].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopPropagation(); history(event.shiftKey || event.key.toLowerCase() === "y"); }
  }, true);
  const flush = () => { void save(); };
  window.addEventListener("beforeunload", flush);
  const untrack = trackCanvas({ path, save });
  const unwatch = ws.vault.onModified(changedPath => { if (changedPath === path && !notifying) { disk.drop(); void load(); } });
  void load();
  return { el, dispose() { gone = true; presentation.dispose(); unregisterPresentation(); flush(); untrack(); window.removeEventListener("beforeunload", flush); navigation.dispose(); cardActions.dispose(); unwatch(); stopEmbeds(); clear(); el.remove(); } };
}
