import { dragPointer, h } from "../shell/dom";
import { settings } from "../settings/store";
import { canvasReadOnly, selectionMenu } from "./controls";
import { closestSide, type CanvasEdge, type CanvasNode, type Side } from "./model";

const geometry = ["x", "y", "width", "height"] as const;
const sides = ["top", "right", "bottom", "left", "topright", "bottomright", "bottomleft", "topleft"];
export function canvasEditing(el: HTMLElement, world: HTMLElement, nodes: CanvasNode[], edges: CanvasEdge[],
  paint: (changed: CanvasNode[]) => void,
  commit: (changed: CanvasNode[], deleted?: Set<string>, edge?: CanvasEdge, deletedEdges?: Set<string>) => void,
  preview: (edge?: CanvasEdge, free?: { end: "from" | "to"; x: number; y: number }) => void,
  history: (redo: boolean) => void, zoom: (nodes: CanvasNode[]) => void, edit: (node: CanvasNode) => void, selectedId?: string) {
  const selected = new Set<string>(selectedId ? [selectedId] : []);
  const selectedEdges = new Set<string>();
  const cards = new Map([...world.querySelectorAll<HTMLElement>(".canvas-node")].map(card => [card.dataset.nodeId!, card]));
  const edgeElements = () => world.querySelectorAll<HTMLElement | SVGElement>("[data-edge-id]");
  for (const card of cards.values()) for (const side of sides.slice(0, 4))
    card.append(h("div", { class: "canvas-node-connection-point", "data-side": side, "aria-label": `Connect ${side}` }));
  const events = new AbortController();
  let cancel: (() => void) | undefined, suppress = false;
  const chosen = () => nodes.filter(n => selected.has(n.id));
  const removeSelected = () => { if ((selected.size || selectedEdges.size) && !canvasReadOnly.has(el)) commit([], selected, undefined, selectedEdges); };
  const menu = selectionMenu(world, removeSelected, () => zoom(chosen()), edit, changed => { paint(changed); commit(changed); });
  const repaint = (changed: CanvasNode[]) => { paint(changed); menu.update(chosen()); };
  function selection() {
    menu.update(chosen());
    for (const el of edgeElements()) el.classList.toggle("is-selected", selectedEdges.has(el.dataset.edgeId!));
    for (const [id, card] of cards) {
      card.classList.toggle("is-selected", selected.has(id));
      card.querySelectorAll(".canvas-node-resizer").forEach(handle => handle.remove());
      if (selected.has(id)) for (const side of sides) card.append(h("div", { class: "canvas-node-resizer", "data-resize": side }));
    }
  }
  function moving() {
    const groups = nodes.filter(n => selected.has(n.id) && n.type === "group");
    return nodes.filter(n => selected.has(n.id) || groups.some(g => n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height));
  }
  function finish(before: CanvasNode[], cancelled: boolean) {
    cancel = undefined;
    if (cancelled) {
      for (const old of before) Object.assign(nodes.find(n => n.id === old.id)!, old);
      repaint(before);
    } else {
      const changed = before.flatMap(old => { const n = nodes.find(n => n.id === old.id)!; return geometry.some(k => n[k] !== old[k]) ? [n] : []; });
      if (changed.length) commit(changed);
    }
  }
  el.addEventListener("pointerdown", e => {
    suppress = false;
    if (e.defaultPrevented || e.button !== 0 || el.classList.contains("is-grabbable")) return;
    const target = e.target as Element;
    if (target.closest(".canvas-controls, .canvas-card-menu, .canvas-selection-menu, .is-editing, a, [data-href], input, button")) return;
    const card = target.closest<HTMLElement>(".canvas-node");
    const node = nodes.find(n => n.id === card?.dataset.nodeId);
    const side = target.closest<HTMLElement>("[data-resize]")?.dataset.resize;
    const edge = edges.find(edge => edge.id === target.closest<HTMLElement>("[data-edge-id]")?.dataset.edgeId);
    const dot = target.closest<HTMLElement>(".canvas-node-connection-point");
    let end = target.closest<HTMLElement>("[data-edge-end]")?.dataset.edgeEnd as "from" | "to" | undefined;
    if (!end && edge && selectedEdges.has(edge.id) && !e.shiftKey) {
      let distance = 24;
      for (const point of edgeElements()) if (point.dataset.edgeId === edge.id && point.dataset.edgeEnd) {
        const r = point.getBoundingClientRect(), gap = Math.hypot(e.clientX - r.x - r.width / 2, e.clientY - r.y - r.height / 2);
        if (gap < distance) { distance = gap; end = point.dataset.edgeEnd as "from" | "to"; }
      }
    }
    e.preventDefault(); el.focus({ preventScroll: true });
    if (dot || end) {
      if (canvasReadOnly.has(el)) return;
      selected.clear(); selectedEdges.clear();
      if (edge) selectedEdges.add(edge.id); else selected.add(node!.id);
      selection();
      const next: CanvasEdge = edge ? { ...edge } : { id: crypto.randomUUID().replaceAll("-", "").slice(0, 16), fromNode: node!.id, fromSide: dot!.dataset.side as Side, toNode: node!.id, toSide: "top" };
      const movingEnd = end ?? "to", nodeKey = movingEnd === "from" ? "fromNode" : "toNode", sideKey = movingEnd === "from" ? "fromSide" : "toSide";
      const matrix = new DOMMatrix(getComputedStyle(world).transform), rect = el.getBoundingClientRect();
      let drop: CanvasNode | undefined;
      world.classList.add("is-connecting");
      for (const el of edgeElements()) if (el.dataset.edgeId === edge?.id) el.classList.add("is-reconnecting");
      cancel = dragPointer(e, el, move => {
        suppress ||= Math.hypot(move.clientX - e.clientX, move.clientY - e.clientY) >= 3;
        const x = (move.clientX - rect.left - matrix.e) / matrix.a, y = (move.clientY - rect.top - matrix.f) / matrix.a;
        drop = nodes.findLast(n => n.type !== "group" && x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height)
          ?? nodes.findLast(n => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height);
        if (drop?.id === next[movingEnd === "from" ? "toNode" : "fromNode"]) drop = undefined;
        for (const [id, card] of cards) card.classList.toggle("is-connection-target", id === drop?.id);
        if (drop) { next[nodeKey] = drop.id; next[sideKey] = closestSide(drop, x, y); }
        preview(next, drop ? undefined : { end: movingEnd, x, y });
      }, cancelled => {
        cancel = undefined; preview(); world.classList.remove("is-connecting");
        for (const el of edgeElements()) el.classList.remove("is-reconnecting");
        for (const card of cards.values()) card.classList.remove("is-connection-target");
        if (!cancelled && suppress && drop && (!edge || next[nodeKey] !== edge[nodeKey] || next[sideKey] !== edge[sideKey])) {
          commit([], undefined, next); selected.clear(); selectedEdges.clear(); selectedEdges.add(next.id); selection();
        }
      });
      return;
    }
    if (edge) {
      const remove = e.shiftKey && selectedEdges.has(edge.id);
      if (!e.shiftKey) { selected.clear(); selectedEdges.clear(); }
      if (remove) selectedEdges.delete(edge.id); else selectedEdges.add(edge.id);
      selection(); return;
    }
    if (node) {
      const removeOnClick = !side && e.shiftKey && selected.has(node.id);
      if (!side && e.shiftKey) selected.add(node.id);
      else if (!selected.has(node.id)) { selected.clear(); selectedEdges.clear(); selected.add(node.id); }
      selection();
      if (canvasReadOnly.has(el)) return;
      const affected = side ? [node] : moving();
      const before = affected.map(n => ({ ...n }));
      const origin = before.find(n => n.id === node.id)!;
      const scale = new DOMMatrix(getComputedStyle(world).transform).a;
      cancel = dragPointer(e, el, move => {
        let dx = (move.clientX - e.clientX) / scale, dy = (move.clientY - e.clientY) / scale;
        if (!suppress && Math.hypot(move.clientX - e.clientX, move.clientY - e.clientY) < 3) return;
        suppress = true;
        if (!side && move.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
        const step = move.altKey || !settings.get("canvas.json").snapToGrid ? 1 : 20;
        const snap = (v: number) => Math.round(v / step) * step;
        if (side) {
          const old = before[0];
          let left = old.x, top = old.y, right = old.x + old.width, bottom = old.y + old.height;
          if (side.includes("left")) left = Math.min(right - 50, snap(old.x + dx));
          if (side.includes("right")) right = Math.max(left + 50, snap(old.x + old.width + dx));
          if (side.includes("top")) top = Math.min(bottom - 50, snap(old.y + dy));
          if (side.includes("bottom")) bottom = Math.max(top + 50, snap(old.y + old.height + dy));
          Object.assign(node, { x: left, y: top, width: right - left, height: bottom - top });
        } else {
          dx = dx === 0 ? 0 : snap(origin.x + dx) - origin.x;
          dy = dy === 0 ? 0 : snap(origin.y + dy) - origin.y;
          if (!move.altKey && settings.get("canvas.json").snapToObjects) {
            for (const [axis, size] of [["x", "width"], ["y", "height"]] as const) {
              if (move.shiftKey && (axis === "x" ? dx === 0 : dy === 0)) continue;
              let best = 5 / scale, offset = 0;
              for (const other of nodes) if (!affected.includes(other)) for (const edge of [0, .5, 1]) for (const at of [0, .5, 1]) {
                const delta = other[axis] + other[size] * edge - (origin[axis] + (axis === "x" ? dx : dy) + origin[size] * at);
                if (Math.abs(delta) < best) { best = Math.abs(delta); offset = delta; }
              }
              if (axis === "x") dx += offset; else dy += offset;
            }
          }
          for (const [i, n] of affected.entries()) { n.x = before[i].x + dx; n.y = before[i].y + dy; }
        }
        repaint(affected);
      }, cancelled => {
        if (!cancelled && !suppress && removeOnClick) { selected.delete(node.id); selection(); }
        finish(before, cancelled);
      }, false);
    } else {
      const initial = e.shiftKey ? new Set(selected) : new Set<string>();
      if (!e.shiftKey) selectedEdges.clear();
      selected.clear(); initial.forEach(id => selected.add(id)); selection();
      const box = h("div", { class: "canvas-selection" });
      el.append(box);
      const rect = el.getBoundingClientRect();
      cancel = dragPointer(e, el, move => {
        const left = Math.min(e.clientX, move.clientX), top = Math.min(e.clientY, move.clientY);
        const right = Math.max(e.clientX, move.clientX), bottom = Math.max(e.clientY, move.clientY);
        suppress = Math.hypot(right - left, bottom - top) >= 3;
        Object.assign(box.style, { left: `${left - rect.left}px`, top: `${top - rect.top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
        selected.clear(); initial.forEach(id => selected.add(id));
        if (suppress) for (const [id, card] of cards) { const r = card.getBoundingClientRect(); if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) selected.add(id); }
        selection();
      }, () => { box.remove(); cancel = undefined; }, false);
    }
  }, { signal: events.signal });
  el.addEventListener("click", e => { if (suppress) { e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true, signal: events.signal });
  el.addEventListener("keydown", e => {
    if ((e.target as Element).closest("input, textarea, [contenteditable=true]")) return;
    if (e.shiftKey && e.code === "Digit2") { e.preventDefault(); zoom(chosen()); return; }
    const undo = (e.ctrlKey || e.metaKey) && ["z", "y"].includes(e.key.toLowerCase());
    const remove = e.key === "Delete" || e.key === "Backspace";
    const direction = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    if (direction && (e.altKey || e.ctrlKey || e.metaKey)) return;
    if (!undo && !remove && !direction && e.key !== "Escape") return;
    e.preventDefault(); e.stopPropagation();
    if (cancel) { cancel(); return; }
    if (undo) history(e.shiftKey || e.key.toLowerCase() === "y");
    else if (canvasReadOnly.has(el) && e.key !== "Escape") return;
    else if (remove) removeSelected();
    else if (direction && chosen().length) {
      const affected = moving(), step = e.shiftKey ? 100 : 5;
      affected.forEach(n => { n.x += direction[0] * step; n.y += direction[1] * step; }); repaint(affected); commit(affected);
    } else if (e.key === "Escape") { selected.clear(); selectedEdges.clear(); selection(); }
  }, { signal: events.signal });
  selection();
  return () => { cancel?.(); events.abort(); menu.dispose(); };
}
