import { clippedEdge, edgeTiles } from "./edgeClip";
import { h } from "../shell/dom";
import { edgeCurve, type CanvasEdge, type CanvasNode } from "./model";
import type { Box } from "./spatial";
import type { CanvasWork } from "./work";
const NS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) {
  const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el;
}
export interface EdgeDrawing { edge: CanvasEdge; line: SVGPathElement; hit: SVGPathElement; ends: HTMLElement[]; marker?: SVGMarkerElement; label?: HTMLElement }
export function canvasEdges(world: HTMLElement, drawing: SVGSVGElement, edges: CanvasEdge[], nodes: Map<string, CanvasNode>, work: CanvasWork, color: (value?: string) => string) {
  interface Batch { edges: CanvasEdge[]; line: SVGPathElement; arrows?: SVGPathElement; box?: Box; paths: Map<string,string> }
  const records = new Map<string, EdgeDrawing>(), batches = new Set<Batch>(), membership = new Map<string, Set<Batch>>();
  const jobs = new Set<object | string>();
  const queue = (key: object | string, job: () => void, weight = 1) => {
    jobs.add(key); work.add(key, () => { jobs.delete(key); job(); }, weight);
  };
  let titles = false, band = 0, revision = 0, gone = false, initialized = false;
  let selected = new Set<string>(), viewport: Box | undefined, lastView = "";
  const paths = new Map<string,string>();
  const curves = new Map<string, ReturnType<typeof edgeCurve>>();
  const size = (el: Element) => { el.classList.add("canvas-band"); el.setAttribute("data-canvas-band", String(band)); };
  const curve = (edge: CanvasEdge) => {
    let value = curves.get(edge.id); if (!value) { value = edgeCurve(nodes.get(edge.fromNode)!, nodes.get(edge.toNode)!, edge); curves.set(edge.id, value); } return value;
  };
  const pathOf = (edge: CanvasEdge) => {
    if (!viewport) return curve(edge).path;
    let path = paths.get(edge.id); if (path === undefined) { path = clippedEdge(curve(edge), viewport); paths.set(edge.id, path); } return path;
  };
  const labelVisible = (edge: CanvasEdge) => {
    if (!edge.label) return false;
    if (!viewport || selected.has(edge.id)) return true;
    const c = curve(edge), radius = edge.label.length * 20 + 12;
    return c.x + radius >= viewport.x && c.x - radius <= viewport.x + viewport.width && c.y + 40 >= viewport.y && c.y - 40 <= viewport.y + viewport.height;
  };
  const inView = (edge: CanvasEdge) => selected.has(edge.id) || !!pathOf(edge) || labelVisible(edge);
  function place(item: EdgeDrawing) {
    const c = curve(item.edge); const path = pathOf(item.edge); item.line.setAttribute("d", path); item.hit.setAttribute("d", path);
    [c.p, c.q].forEach((p, i) => { if (item.ends[i]) Object.assign(item.ends[i].style, { left: `${p[0]}px`, top: `${p[1]}px` }); });
    if (item.label) Object.assign(item.label.style, { left: `${c.x}px`, top: `${c.y}px` });
  }
  function remove(item: EdgeDrawing) { item.line.remove(); item.hit.parentElement?.remove(); item.marker?.remove(); item.ends.forEach(e => e.remove()); item.ends = []; if (!item.label?.classList.contains("is-editing")) { item.label?.remove(); records.delete(item.edge.id); } }
  function select(item: EdgeDrawing) {
    if (!titles && selected.has(item.edge.id) && !item.ends.length) {
      item.ends = ["from", "to"].map(end => h("div", { class: "canvas-edge-end", "data-edge-id": item.edge.id, "data-edge-end": end, "aria-label": `Reconnect ${end} end` }));
      item.ends.forEach(el => { size(el); world.append(el); }); place(item);
    } else if (titles || !selected.has(item.edge.id)) { item.ends.forEach(e => e.remove()); item.ends = []; }
    for (const el of [item.line, item.hit, item.label, ...item.ends]) el?.classList.toggle("is-selected", selected.has(item.edge.id));
  }
  function update(item: EdgeDrawing) {
    const { edge, line, hit } = item;
    for (const path of [line, hit]) { path.setAttribute("stroke", color(edge.color)); size(path); }
    const c = curve(edge), inside = (p: number[]) => !viewport || p[0] >= viewport.x - 12 && p[0] <= viewport.x + viewport.width + 12 && p[1] >= viewport.y - 12 && p[1] <= viewport.y + viewport.height + 12;
    const start = edge.fromEnd === "arrow" && inside(c.p), end = edge.toEnd !== "none" && inside(c.q);
    if (start || end) {
      if (!item.marker) {
        item.marker = svg("marker", { id: `canvas-arrow-${crypto.randomUUID()}`, viewBox: "0 0 10 10", refX: "10", refY: "5", markerWidth: "10", markerHeight: "10", markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" });
        item.marker.append(svg("path", { d: "M0,0 L10,5 L0,10 Z", "stroke-width": "2" })); drawing.append(item.marker);
      }
      for (const key of ["fill", "stroke"]) item.marker.firstElementChild!.setAttribute(key, color(edge.color));
    } else { item.marker?.remove(); item.marker = undefined; }
    line.setAttribute("marker-start", start ? `url(#${item.marker!.id})` : "none");
    line.setAttribute("marker-end", end ? `url(#${item.marker!.id})` : "none");
    if (item.label?.classList.contains("is-editing")) { /* Keep its live editor. */ }
    else if (labelVisible(edge)) { if (!item.label) { item.label = h("div", { class: "canvas-edge-label", "data-edge-id": edge.id }); world.append(item.label); } item.label.textContent = edge.label ?? ""; }
    else { item.label?.remove(); item.label = undefined; }
    select(item); place(item);
  }
  function add(edge: CanvasEdge) {
    if (records.has(edge.id)) { const item = records.get(edge.id)!;
      if (item.line.parentNode !== drawing) { const group = svg("g", {}); group.append(item.hit); drawing.append(group, ...item.marker ? [item.marker] : [], item.line); }
      update(item); return;
    }
    const line = svg("path", { class: "canvas-edge", "data-edge-id": edge.id, fill: "none", "stroke-width": "2" });
    const hit = svg("path", { class: "canvas-edge-hit", "data-edge-id": edge.id, fill: "none" });
    const group = svg("g", {}); group.append(hit); drawing.append(group, line);
    const item: EdgeDrawing = { edge, line, hit, ends: [] }; records.set(edge.id, item); update(item);
  }
  function removeBatch(batch: Batch) {
    batch.line.remove(); batch.arrows?.remove(); batches.delete(batch);
    for (const edge of batch.edges) { const set = membership.get(edge.id); set?.delete(batch); if (!set?.size) membership.delete(edge.id); }
  }
  function refreshBatch(batch: Batch) {
    const paths: string[] = [], arrows: string[] = [];
    const inside = (p: number[]) => !viewport || p[0] >= viewport.x - 12 && p[0] <= viewport.x + viewport.width + 12 && p[1] >= viewport.y - 12 && p[1] <= viewport.y + viewport.height + 12;
    const arrow = (tip: number[], inner: number[]) => {
      const dx = (tip[0] - inner[0]) / 7, dy = (tip[1] - inner[1]) / 7;
      const x = tip[0] - dx * 10, y = tip[1] - dy * 10;
      return `M${tip} L${x - dy * 5},${y + dx * 5} L${x + dy * 5},${y - dx * 5} Z`;
    };
    for (const edge of batch.edges) {
      let path = batch.paths.get(edge.id);
      if (path === undefined) { path = batch.box ? clippedEdge(curve(edge), batch.box) : pathOf(edge); batch.paths.set(edge.id, path); }
      if (!path) continue;
      paths.push(path); const c = curve(edge);
      const owner = (p: number[]) => !batch.box || p[0] >= batch.box.x && p[0] < batch.box.x + batch.box.width && p[1] >= batch.box.y && p[1] < batch.box.y + batch.box.height;
      if (edge.fromEnd === "arrow" && inside(c.p) && owner(c.p)) arrows.push(arrow(c.p, c.start));
      if (edge.toEnd !== "none" && inside(c.q) && owner(c.q)) arrows.push(arrow(c.q, c.end));
    }
    batch.line.setAttribute("d", paths.join(" ")); size(batch.line);
    const edge = batch.edges[0]; batch.line.classList.toggle("is-selected", selected.has(edge.id));
    if (arrows.length) {
      if (!batch.arrows) { batch.arrows = svg("path", { class: "canvas-edge-arrows", fill: color(edge.color) }); drawing.append(batch.arrows); }
      batch.arrows.setAttribute("d", arrows.join(" "));
    } else { batch.arrows?.remove(); batch.arrows = undefined; }
  }
  function addBatch(edges: CanvasEdge[], box?: Box, paths = new Map<string,string>()) {
    const line = svg("path", { class: "canvas-edge canvas-edge-batch", fill: "none", stroke: color(edges[0].color) });
    const batch: Batch = { edges, line, box, paths }; drawing.append(line); batches.add(batch);
    for (const edge of edges) { let set = membership.get(edge.id); if (!set) membership.set(edge.id, set = new Set()); set.add(batch); }
    refreshBatch(batch); return batch;
  }
  const tiles = (edge: CanvasEdge): (Box | undefined)[] => edges.length >= 1000 && viewport ? edgeTiles(curve(edge), viewport, 1024) : [undefined];
  function rebuild(clearOld = false) {
    for (const key of jobs) work.cancel(key); jobs.clear();
    const token = ++revision, oldBatches = [...batches];
    if (clearOld) { oldBatches.forEach(removeBatch); oldBatches.length = 0; }
    if (!titles) {
      for (let i = 0; i < edges.length; i += 16) queue(`full:${i}`, () => {
        if (gone || token !== revision) return;
        for (const edge of edges.slice(i, i + 16)) { if (inView(edge)) add(edge); else { const item = records.get(edge.id); if (item) remove(item); } }
      }, 16);
      queue(batches, () => { if (token === revision) oldBatches.forEach(removeBatch); });
      return;
    }
    for (const item of records.values()) queue(item, () => { if (token === revision) remove(item); });
    const grouped = new Map<string, {edges: CanvasEdge[]; box?: Box; paths: Map<string,string>}>();
    for (let i = 0; i < edges.length; i += 4) queue(`edges:${i}`, () => {
      if (gone || token !== revision) return;
      for (const edge of edges.slice(i, i + 4)) {
        if (!pathOf(edge)) continue;
        for (const box of tiles(edge)) {
          const path = box ? clippedEdge(curve(edge), box) : pathOf(edge); if (!path) continue;
          const key = `${box?.x}/${box?.y}/${edge.color ?? ""}/${edge.fromEnd ?? "none"}/${edge.toEnd ?? "arrow"}/${selected.has(edge.id)}`;
          let group = grouped.get(key); if (!group) grouped.set(key, group = {edges: [], box, paths: new Map()}); group.edges.push(edge); group.paths.set(edge.id,path);
        }
      }
    });
    queue(batches, () => {
      if (gone || token !== revision) return;
      for (const group of grouped.values()) for (let i = 0; i < group.edges.length; i += 256) queue({}, () => {
        if (!gone && token === revision) addBatch(group.edges.slice(i, i + 256), group.box, group.paths);
      }, group.box ? 1 : 8);
      queue({}, () => { if (token === revision) oldBatches.forEach(removeBatch); });
    });
  }
  return { place, get: (id: string) => records.get(id),
    mode(next: boolean, zoom: number, view?: Box) {
      const same = initialized && titles === next && band === zoom;
      // Ignore floating-point noise from a zoom out-and-back; transforms retain
      // full precision. Rewriting even an identical SVG viewBox dirties its raster.
      const key = view ? [view.x,view.y,view.width,view.height].map(v => v.toFixed(2)).join("/") : "", moved = key !== lastView;
      if (same && !moved) return;
      lastView = key;
      if (moved) {
        paths.clear();
        if (view) {
          viewport = { x: view.x - view.width / 4, y: view.y - view.height / 4, width: view.width * 1.5, height: view.height * 1.5 };
          Object.assign(drawing.style, { left: `${viewport.x}px`, top: `${viewport.y}px`, width: `${viewport.width}px`, height: `${viewport.height}px`, overflow: "hidden" });
          drawing.setAttribute("viewBox", `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);
        } else viewport = undefined;
      }
      const switchMode = !initialized || titles !== next; initialized = true; titles = next; band = zoom;
      if (switchMode || moved) rebuild(true);
      else { for (const item of records.values()) queue(item, () => { for (const el of [item.line, item.hit, ...item.ends]) size(el); }); for (const p of batches) queue(p, () => size(p.line), 8); }
    },
    select(ids: Set<string>) { const changed = ids.size !== selected.size || [...ids].some(id => !selected.has(id)); selected = new Set(ids); if (titles) { if (changed) rebuild(); return; } for (const item of records.values()) if (ids.has(item.edge.id) || item.ends.length) select(item); },
    update(edge: CanvasEdge) { curves.delete(edge.id); paths.delete(edge.id); const item = records.get(edge.id); if (item) update(item); if (titles) rebuild(); else if (!item) add(edge); },
    changed(ids: Set<string>) {
      const affected = edges.filter(edge => ids.has(edge.fromNode) || ids.has(edge.toNode));
      for (const edge of affected) { curves.delete(edge.id); paths.delete(edge.id); }
      if (titles) {
        const touched = new Set<Batch>();
        for (const edge of affected) {
          const old = membership.get(edge.id);
          if (old) for (const batch of old) { batch.paths.delete(edge.id); touched.add(batch); }
          for (const box of tiles(edge)) if (![...old ?? []].some(batch => batch.box?.x === box?.x && batch.box?.y === box?.y)) {
            const path = box ? clippedEdge(curve(edge), box) : pathOf(edge);
            if (path) addBatch([edge], box, new Map([[edge.id,path]]));
          }
        }
        touched.forEach(refreshBatch);
      } else for (const edge of affected) {
        const item = records.get(edge.id);
        if (inView(edge)) { if (item) update(item); else add(edge); } else if (item) remove(item);
      }
    },
    settle() { if (titles) rebuild(); },
    dispose() { gone = true; revision++; },
  };
}
