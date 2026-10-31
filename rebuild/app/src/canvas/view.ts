// Plain DOM/SVG board. Detached, read-only editor contexts reuse Reading's
// renderer and local embeds; embedded note editors use the shared note save path.
import { markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { api } from "../api";
import { IMAGE_EXT, embedPart } from "../editor/embeds";
import { editorHost } from "../editor/host";
import { readingMode, release, render } from "../editor/render";
import { isExternalUrl, isNotePath } from "../links/external";
import { resolveLink } from "../links/internal";
import { isNoteFile, noteName } from "../paths";
import { h } from "../shell/dom";
import type { Group, Tab } from "../tabs";
import { whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { canvasReadOnly } from "./controls";
import { canvasCards, editTextCard } from "./cards";
import { canvasNavigation, titleBand } from "./navigation";
import { editCanvas } from "./document";
import { canvasEditing } from "./editing";
import { spaceCardBody } from "./spacing";
import { groupBackground } from "./groups";
import { editNoteCard } from "./note";
import { editCanvasLabel } from "./labels";
import { canvasTitle, edgeCurve, readCanvas, type CanvasEdge, type CanvasNode } from "./model";
import type { Guide } from "./align";

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
// Zoomed out, a card too small on screen for its title shows as a box (navigation.ts).
function sizeTitle(card: HTMLElement, node: CanvasNode) {
  const band = titleBand(node.width, node.height)?.toString();
  if (band === card.dataset.titleBand) return;
  if (band === undefined) delete card.dataset.titleBand; else card.dataset.titleBand = band;
}
export function createCanvasView(ws: Workspace, path: string, group: Group, tab: Tab) {
  const host = ws.editors.viewOf(group).state.facet(editorHost)!;
  const world = h("div", { class: "canvas-world" });
  const el = h("div", { class: "view-content canvas-view", "aria-label": "Canvas", tabindex: "0" }, world);
  let gone = false, generation = 0, loading = 0, source = "", timer = 0, notifying = false;
  let undo: string[] = [], redo: string[] = [];
  let writing = Promise.resolve();
  let stopText: ((paint?: boolean) => void) | undefined;
  let selectAfterDraw: string | undefined, editAfterDraw: string | undefined;
  function save() {
    clearTimeout(timer); timer = 0;
    const text = source;
    writing = writing.then(async () => {
      try {
        await api.writeNote(path, text);
        notifying = true;
        try { ws.vault.written(path); } finally { notifying = false; }
      } catch (err) { console.error(`Could not save ${path}`, err); }
    });
  }
  function changed(next: string, redraw = false) {
    if (next === source) return;
    source = next;
    navigation.updateHistory(undo.some(text => text !== source), redo.some(text => text !== source));
    clearTimeout(timer); timer = window.setTimeout(save, 300);
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
  let cleanups: (() => void)[] = [];
  const clear = () => { cardActions.reset(); stopText?.(false); cleanups.splice(0).reverse().forEach(fn => fn()); world.replaceChildren(); };
  const navigation = canvasNavigation(el, world, tab, path, history, () => draw());
  const cardActions = canvasCards(el, world, ws, (node, edge) => {
    if (gone || canvasReadOnly.has(el)) return;
    stopText?.();
    const nodes = Array.isArray(node) ? node : [node];
    if (!nodes.length) return;
    undo.push(source); redo = [];
    selectAfterDraw = nodes[0].id; editAfterDraw = nodes.length === 1 && nodes[0].type === "text" && !nodes[0].text ? nodes[0].id : undefined;
    changed(editCanvas(source, [], undefined, nodes, edge ? [edge] : []), true);
    if (!(nodes.length === 1 && nodes[0].type === "text" && !nodes[0].text)) el.focus({ preventScroll: true });
  });
  const openBoardMenu = (x: number, y: number) => cardActions.boardMenu(x, y, {
    undo: undo.some(text => text !== source),
    redo: redo.some(text => text !== source),
    apply: history,
  }, () => draw());
  async function load() {
    const mine = ++loading;
    let text: string;
    try { text = await api.readNote(path); } catch { text = ""; }
    if (gone || mine !== loading) return;
    if (text === source && world.childElementCount) return;
    clearTimeout(timer); timer = 0;
    source = text; undo = []; redo = [];
    draw();
  }
  function draw() {
    clear();
    const mine = ++generation;
    const selectedId = selectAfterDraw, editId = editAfterDraw;
    selectAfterDraw = editAfterDraw = undefined;
    let startEditor: (() => void) | undefined;
    const { nodes, edges } = readCanvas(source);
    const bounds = boundsOf();
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
    const updateEdges: { edge: CanvasEdge; line: SVGPathElement; hit: SVGPathElement; ends: HTMLElement[]; marker: SVGMarkerElement; label?: HTMLElement }[] = [];
    function place(item: typeof updateEdges[number], curve: ReturnType<typeof edgeCurve>) {
      item.line.setAttribute("d", curve.path); item.hit.setAttribute("d", curve.path);
      [curve.p, curve.q].forEach((p, i) => Object.assign(item.ends[i].style, { left: `${p[0]}px`, top: `${p[1]}px` }));
      if (item.label) { item.label.style.left = `${curve.x}px`; item.label.style.top = `${curve.y}px`; }
    }
    function addEdge(edge: CanvasEdge, i: number) {
      const line = svg("path", { class: "canvas-edge", "data-edge-id": edge.id, fill: "none", stroke: color(edge.color), "stroke-width": "2" });
      const hit = svg("path", { class: "canvas-edge-hit", "data-edge-id": edge.id, fill: "none", stroke: color(edge.color) });
      drawing.append(svg("g", {}, hit));
      const marker = arrowMarker(`canvas-arrow-${group.id}-${mine}-${i}`, color(edge.color));
      drawing.append(marker);
      drawing.append(line);
      const ends = ["from", "to"].map(end => h("div", { class: "canvas-edge-end", "data-edge-id": edge.id, "data-edge-end": end, "aria-label": `Reconnect ${end} end` }));
      world.append(...ends);
      const update: typeof updateEdges[number] = { edge, line, hit, ends, marker };
      updateEdges.push(update);
      updateEdge(update);
    }
    function updateEdge(update: typeof updateEdges[number]) {
      const { edge, line, hit, marker } = update;
      for (const path of [line, hit]) path.setAttribute("stroke", color(edge.color));
      for (const key of ["fill", "stroke"]) marker.firstElementChild!.setAttribute(key, color(edge.color));
      for (const [end, enabled] of [["start", edge.fromEnd === "arrow"], ["end", edge.toEnd !== "none"]] as const)
        line.setAttribute(`marker-${end}`, enabled ? `url(#${marker.id})` : "none");
      if (typeof edge.label === "string" && edge.label) {
        if (!update.label) { update.label = h("div", { class: "canvas-edge-label", "data-edge-id": edge.id }); world.append(update.label); }
        update.label.textContent = edge.label;
      }
      else { update.label?.remove(); update.label = undefined; }
      place(update, edgeCurve(byId.get(edge.fromNode)!, byId.get(edge.toNode)!, edge));
    }
    edges.forEach(addEdge);
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
    for (const node of nodes) {
      const card = h("div", { class: `canvas-node canvas-node-${node.type}`, "data-node-id": node.id });
      // Hover resolves links from this note, or from the canvas file for a text card.
      if (node.type === "text") card.dataset.path = path;
      else if (node.type === "file" && isNoteFile(node.file ?? "")) card.dataset.path = node.file!;
      Object.assign(card.style, { left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` });
      if (node.color) card.classList.add("is-colored");
      card.style.setProperty("--canvas-color", color(node.color));
      // The zoom bands size this ring, not the card, so a band change never restyles a card.
      card.append(h("div", { class: "canvas-node-ring" }));
      world.append(card);
      let refreshFile = () => {};
      if (node.type === "file" && node.file) cleanups.push(ws.embeds.watch(node.file, () => {
        queueMicrotask(() => { if (!gone && mine === generation) refreshFile(); });
      }));
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
        continue;
      }
      if (node.type === "file" || node.type === "link") card.append(h("div", { class: "canvas-file-label" }, node.type === "link" ? node.url ?? "" : canvasTitle(node)));
      const content = h("div", { class: "canvas-node-content markdown-rendered is-reading-mode" });
      card.append(content);
      // Title mode shows an image itself; every other card shows this instead of its body.
      const image = node.type === "file" && IMAGE_EXT.test(node.file ?? "");
      const title = h("div", { class: "canvas-node-title" }, image ? "" : canvasTitle(node));
      if (image) card.classList.add("is-image"); else { card.append(title); sizeTitle(card, node); }
      if (node.type === "link") {
        const url = node.url ?? "";
        const link = h("a", { class: "cm-link cm-rendered-link", role: "link", tabindex: "0" }, url);
        const open = () => { if (isExternalUrl(url)) void api.openExternal(url).catch(console.warn); };
        link.addEventListener("click", e => { if (e.isTrusted) open(); });
        link.addEventListener("keydown", e => { if (e.isTrusted && e.key === "Enter") open(); });
        content.append(link);
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
        cleanups.push(() => held?.release()); refreshFile();
        continue;
      }
      if (node.type === "file" && !isNoteFile(node.file ?? "")) {
        content.textContent = node.file ? `Unsupported file: ${node.file}` : "File not found";
        continue;
      }
      const origin = node.type === "file" ? node.file! : path;
      const resolve = (href: string) => resolveLink(href, origin, ws.vault.files.filter(f => !f.is_dir));
      const cardHost = {
        ...host, contextMenu: undefined, properties: undefined,
        formatLink: (target: string, _view: EditorView, display?: string, subpath?: string) => ws.linkTo(target, origin, display, subpath),
        linkExists: (href: string) => !!resolve(href),
        openLink: (href: string, where: false | "tab" | "right") => {
          const hash = href.indexOf("#"), name = hash < 0 ? href : href.slice(0, hash);
          void ws.openLink(`${name ? resolve(name) ?? name : origin}${hash < 0 ? "" : href.slice(hash)}`, where, group);
        },
        embeds: { ...ws.embeds, pathOf: () => origin, resolve: (href: string) => resolve(href), toggleTask: () => {} },
      };
      const context = new EditorView({ state: EditorState.create({ extensions: [EditorState.readOnly.of(true), readingMode.of(true), editorHost.of(cardHost)] }) });
      cleanups.push(() => context.destroy());
      content.addEventListener("click", event => {
        const link = (event.target as Element).closest<HTMLElement>("[data-href]");
        if (!event.isTrusted || !link || card.classList.contains("is-editing")) return;
        event.preventDefault();
        const href = link.dataset.href!;
        if (isNotePath(href) || href.startsWith("#")) cardHost.openLink(href, whereFromEvent(event));
        else if (isExternalUrl(href)) void api.openExternal(href).catch(console.warn);
      });
      let painted: ReturnType<typeof render> | undefined;
      cleanups.push(() => { if (painted) release(painted); });
      const paint = (source: string) => {
        if (gone || mine !== generation || card.classList.contains("is-editing")) return;
        const shown = embedPart(source, node.type === "file" ? node.subpath?.replace(/^#/, "") ?? "" : "");
        if (!shown) { content.textContent = `Unable to find “${node.subpath}” in “${node.file}”.`; return; }
        if (painted) release(painted);
        content.replaceChildren(); content.classList.add("is-reading-mode");
        painted = render(content, node.type === "file" ? withoutBlockIds(shown.text) : shown.text, context, [origin], () => {});
        spaceCardBody(content, painted.state);
        if (node.type === "file") content.prepend(h("div", { class: "canvas-note-title" }, noteName(node.file!)));
        content.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => input.disabled = true);
      };
      if (node.type === "text") {
        paint(node.text ?? "");
        const edit = () => {
          if (canvasReadOnly.has(el) || card.classList.contains("is-editing")) return;
          stopText?.();
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
          void ws.embeds.read(origin).then(paint, () => { if (!gone && mine === generation && !card.classList.contains("is-editing")) content.textContent = `File not found: ${origin}`; });
        };
        refreshFile();
      }
    }
    const cards = new Map([...world.querySelectorAll<HTMLElement>(".canvas-node")].map(card => [card.dataset.nodeId!, card]));
    cleanups.push(canvasEditing(el, world, nodes, edges, changed => {
      const ids = new Set(changed.map(n => n.id));
      for (const n of changed) {
        const card = cards.get(n.id)!;
        Object.assign(card.style, { left: `${n.x}px`, top: `${n.y}px`, width: `${n.width}px`, height: `${n.height}px` });
        if (n.type !== "group" && !card.classList.contains("is-image")) sizeTitle(card, n);
        card.classList.toggle("is-colored", !!n.color); card.style.setProperty("--canvas-color", color(n.color)); backgrounds.get(n.id)?.();
      }
      for (const item of updateEdges) if (ids.has(item.edge.fromNode) || ids.has(item.edge.toNode))
        place(item, edgeCurve(byId.get(item.edge.fromNode)!, byId.get(item.edge.toNode)!, item.edge));
      navigation.loaded(boundsOf());
    }, (nodes, deleted, changedEdges, deletedEdges, added = []) => {
      const next = editCanvas(source, nodes, deleted, added, changedEdges, deletedEdges);
      if (next === source) return;
      undo.push(source); redo = [];
      for (const edge of changedEdges ?? []) {
        const item = updateEdges.find(item => item.edge.id === edge.id);
        if (item) { Object.assign(item.edge, edge); updateEdge(item); }
        else { edges.push(edge); addEdge(edge, edges.length - 1); }
      }
      if (added.length) { selectAfterDraw = added[0].id; editAfterDraw = added[0].id; }
      changed(next, !!deleted?.size || !!deletedEdges?.size || !!added.length);
    }, previewEdge, cardActions.connect, history, nodes => navigation.zoomTo(nodes), (item, refresh) => {
      if (!("fromNode" in item)) { edits.get(item.id)?.(undefined, refresh); return; }
      if (canvasReadOnly.has(el)) return;
      const record = updateEdges.find(record => record.edge.id === item.id)!;
      if (record.label?.classList.contains("is-editing")) return;
      stopText?.();
      const label = record.label ?? h("div", { class: "canvas-edge-label", "data-edge-id": item.id });
      record.label = label; world.append(label); place(record, edgeCurve(byId.get(item.fromNode)!, byId.get(item.toNode)!, item));
      label.textContent = item.label ?? "";
      label.setAttribute("aria-label", "Edge label");
      stopText = editCanvasLabel(label, (value, save) => {
        stopText = undefined;
        if (save) {
          if (value !== item.label) {
            item.label = value; undo.push(source); redo = [];
            changed(editCanvas(source, [], undefined, [], [item]));
          }
          updateEdge(record); refresh();
        }
      });
    }, selectedId, (node, anchor, apply) => groupBackground(ws, node, anchor, apply, () => !gone && mine === generation && !canvasReadOnly.has(el)), showGuides, openBoardMenu));
    startEditor?.();
    function boundsOf() { return nodes.length ? { left: Math.min(...nodes.map(n => n.x)), top: Math.min(...nodes.map(n => n.y)), right: Math.max(...nodes.map(n => n.x + n.width)), bottom: Math.max(...nodes.map(n => n.y + n.height)) } : { left: 0, top: 0, right: 0, bottom: 0 }; }
    navigation.loaded(bounds);
    navigation.updateHistory(undo.some(text => text !== source), redo.some(text => text !== source));
  }
  const flush = () => { if (timer) save(); };
  window.addEventListener("beforeunload", flush);
  const unwatch = ws.vault.onModified(changed => { if (changed === path && !notifying) { clearTimeout(timer); timer = 0; void load(); } });
  void load();
  return { el, dispose() { gone = true; flush(); window.removeEventListener("beforeunload", flush); navigation.dispose(); cardActions.dispose(); unwatch(); clear(); el.remove(); } };
}
