import { isNoteFile } from "../paths";
import { dragPointer, h } from "../shell/dom";
import { settings } from "../settings/store";
import { closeMenu, showMenu, SEPARATOR } from "../shell/menu";
import { canvasReadOnly, selectionMenu } from "./controls";
import type { BackgroundPicker } from "./groups";
import { alignTargets, guidesFor, snapOffset, type Guide } from "./align";
import { closestSide, type CanvasEdge, type CanvasNode, type Side } from "./model";

const geometry = ["x", "y", "width", "height"] as const;
const sides = ["top", "right", "bottom", "left", "topright", "bottomright", "bottomleft", "topleft"];
export function canvasEditing(el: HTMLElement, world: HTMLElement, nodes: CanvasNode[], edges: CanvasEdge[],
  paint: (changed: CanvasNode[]) => void,
  commit: (changed: CanvasNode[], deleted?: Set<string>, changedEdges?: CanvasEdge[], deletedEdges?: Set<string>, added?: CanvasNode[]) => void,
  preview: (edge?: CanvasEdge, free?: { end: "from" | "to"; x: number; y: number }) => void,
  connect: (edge: CanvasEdge, at: { x: number; y: number }, finished: () => void) => void,
  history: (redo: boolean) => void, zoom: (nodes: Pick<CanvasNode, "x" | "y" | "width" | "height">[]) => void, edit: (item: CanvasNode | CanvasEdge, refresh: () => void) => void, selectedId: string | undefined, background: BackgroundPicker,
  guides: (list: Guide[], radius: number) => void, openBoardMenu: (x: number, y: number) => void) {
  const selected = new Set<string>(selectedId ? [selectedId] : []);
  const selectedEdges = new Set<string>();
  const cards = new Map([...world.querySelectorAll<HTMLElement>(".canvas-node")].map(card => [card.dataset.nodeId!, card]));
  const edgeElements = () => world.querySelectorAll<HTMLElement | SVGElement>("[data-edge-id]");
  // Connection dots show only on a hovered or selected card, so they are made then:
  // four per card up front would be restyled by every zoom-band change.
  const dotted = new WeakSet<HTMLElement>();
  const dots = (card: HTMLElement) => {
    if (dotted.has(card)) return;
    dotted.add(card);
    for (const side of sides.slice(0, 4)) card.append(h("div", { class: "canvas-node-connection-point", "data-side": side, "aria-label": `Connect ${side}` }));
  };
  const events = new AbortController();
  world.addEventListener("pointerover", e => { const card = (e.target as Element).closest<HTMLElement>(".canvas-node"); if (card && cards.get(card.dataset.nodeId!) === card) dots(card); }, { signal: events.signal });
  let cancel: (() => void) | undefined, suppress = false, pressedLabel: string | undefined;
  const chosen = () => nodes.filter(n => selected.has(n.id));
  let context: Element | null = null;
  const createGroup = () => {
    const items = chosen();
    if (!items.length || canvasReadOnly.has(el)) return;
    const x = Math.min(...items.map(n => n.x)) - 20, y = Math.min(...items.map(n => n.y)) - 20;
    commit([], undefined, undefined, undefined, [{ id: crypto.randomUUID().replaceAll("-", "").slice(0, 16), x, y,
      width: Math.max(...items.map(n => n.x + n.width)) + 20 - x, height: Math.max(...items.map(n => n.y + n.height)) + 20 - y, type: "group", label: "Untitled group" }]);
  };
  const removeSelected = () => { if ((selected.size || selectedEdges.size) && !canvasReadOnly.has(el)) { commit([], selected, undefined, selectedEdges); el.focus({ preventScroll: true }); } };
  const menu = selectionMenu(world, nodes, removeSelected, zoom, item => edit(item, selection), changed => {
    const cards = changed.filter((item): item is CanvasNode => !("fromNode" in item));
    paint(cards); commit(cards, undefined, changed.filter((item): item is CanvasEdge => "fromNode" in item));
    menu.update(chosen(), edges.filter(edge => selectedEdges.has(edge.id)));
    if (!world.querySelector(".canvas-node.is-editing")) el.focus({ preventScroll: true });
  }, createGroup, background);
  const repaint = (changed: CanvasNode[]) => { paint(changed); menu.update(chosen(), edges.filter(edge => selectedEdges.has(edge.id))); };
  function selection() {
    menu.update(chosen(), edges.filter(edge => selectedEdges.has(edge.id)));
    for (const el of edgeElements()) el.classList.toggle("is-selected", selectedEdges.has(el.dataset.edgeId!));
    for (const [id, card] of cards) {
      if (card.classList.contains("is-selected") === selected.has(id)) continue;
      card.classList.toggle("is-selected", selected.has(id));
      card.querySelectorAll(".canvas-node-resizer").forEach(handle => handle.remove());
      if (selected.has(id)) { dots(card); for (const side of sides) card.append(h("div", { class: "canvas-node-resizer", "data-resize": side })); }
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
    suppress = false; pressedLabel = undefined;
    if (e.defaultPrevented || e.button !== 0 || el.classList.contains("is-grabbable")) return;
    const target = e.target as Element;
    if (target.closest(".canvas-controls, .canvas-card-menu, .canvas-selection-menu, .is-editing, a, [data-href], input, button")) return;
    // Reconnect handles may overlap a short label; cards still cover labels.
    const beneath = target.closest(".canvas-edge-end") ? document.elementsFromPoint(e.clientX, e.clientY).find(el => el.matches(".canvas-edge-label, .canvas-node")) : target;
    const label = beneath?.closest<HTMLElement>(".canvas-edge-label");
    pressedLabel = label?.dataset.edgeId;
    const card = target.closest<HTMLElement>(".canvas-node");
    const node = nodes.find(n => n.id === card?.dataset.nodeId);
    const side = target.closest<HTMLElement>("[data-resize]")?.dataset.resize;
    const edge = edges.find(edge => edge.id === target.closest<HTMLElement>("[data-edge-id]")?.dataset.edgeId);
    const dot = target.closest<HTMLElement>(".canvas-node-connection-point");
    let end = label ? undefined : target.closest<HTMLElement>("[data-edge-end]")?.dataset.edgeEnd as "from" | "to" | undefined;
    if (!label && !end && edge && selectedEdges.has(edge.id) && !e.shiftKey) {
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
      let drop: CanvasNode | undefined, endPoint = e;
      world.classList.add("is-connecting");
      for (const el of edgeElements()) if (el.dataset.edgeId === edge?.id) el.classList.add("is-reconnecting");
      cancel = dragPointer(e, el, move => {
        endPoint = move;
        suppress ||= Math.hypot(move.clientX - e.clientX, move.clientY - e.clientY) >= 3;
        const x = (move.clientX - rect.left - matrix.e) / matrix.a, y = (move.clientY - rect.top - matrix.f) / matrix.a;
        // Dots are 20 screen pixels, centered inside the card's 1px border.
        const radius = 10 / matrix.a;
        const hit = (n: CanvasNode) => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height
          || Math.abs(y - n.y - n.height / 2) < radius && (Math.abs(x - n.x - 1) < radius || Math.abs(x - n.x - n.width + 1) < radius)
          || Math.abs(x - n.x - n.width / 2) < radius && (Math.abs(y - n.y - 1) < radius || Math.abs(y - n.y - n.height + 1) < radius);
        drop = nodes.findLast(n => n.type !== "group" && hit(n)) ?? nodes.findLast(hit);
        if (drop?.id === next[movingEnd === "from" ? "toNode" : "fromNode"]) drop = undefined;
        for (const [id, card] of cards) card.classList.toggle("is-connection-target", id === drop?.id);
        if (drop) { next[nodeKey] = drop.id; next[sideKey] = closestSide(drop, x, y); }
        preview(next, drop ? undefined : { end: movingEnd, x, y });
      }, cancelled => {
        cancel = undefined; world.classList.remove("is-connecting");
        for (const el of edgeElements()) el.classList.remove("is-reconnecting");
        for (const card of cards.values()) card.classList.remove("is-connection-target");
        if (!cancelled && suppress && drop && (!edge || next[nodeKey] !== edge[nodeKey] || next[sideKey] !== edge[sideKey])) {
          commit([], undefined, [next]); selected.clear(); selectedEdges.clear(); selectedEdges.add(next.id); selection();
        }
        const over = document.elementFromPoint(endPoint.clientX, endPoint.clientY);
        if (!cancelled && suppress && !edge && !drop && el.contains(over) && !over?.closest(".canvas-node, [data-edge-id], .canvas-controls, .canvas-card-menu, .canvas-selection-menu"))
          connect(next, { x: endPoint.clientX, y: endPoint.clientY }, () => preview());
        else preview();
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
      // Alignment: the other cards' edges and centers, sorted once for the whole drag.
      const targets = alignTargets(nodes.filter(n => !affected.includes(n)));
      const within = 6 / scale;
      const left0 = Math.min(...before.map(n => n.x)), top0 = Math.min(...before.map(n => n.y));
      const span = { width: Math.max(...before.map(n => n.x + n.width)) - left0, height: Math.max(...before.map(n => n.y + n.height)) - top0 };
      let shown = "";
      const show = (list: Guide[]) => { const key = JSON.stringify(list); if (key !== shown) { shown = key; guides(list, 3 / scale); } };
      cancel = dragPointer(e, el, move => {
        let dx = (move.clientX - e.clientX) / scale, dy = (move.clientY - e.clientY) / scale;
        if (!suppress && Math.hypot(move.clientX - e.clientX, move.clientY - e.clientY) < 3) return;
        suppress = true;
        if (!side && move.shiftKey) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
        const step = move.altKey || !settings.get("canvas.json").snapToGrid ? 1 : 20;
        const snap = (v: number) => Math.round(v / step) * step;
        const align = !move.altKey && settings.get("canvas.json").snapToObjects;
        const found: Guide[] = [];
        if (side) {
          const old = before[0];
          const edge = { left: old.x, top: old.y, right: old.x + old.width, bottom: old.y + old.height };
          if (side.includes("left")) edge.left = snap(old.x + dx);
          if (side.includes("right")) edge.right = snap(old.x + old.width + dx);
          if (side.includes("top")) edge.top = snap(old.y + dy);
          if (side.includes("bottom")) edge.bottom = snap(old.y + old.height + dy);
          // Only the dragged edges align: 0 is the start edge, 1 the end edge.
          const stops = (start: string, end: string) => [...side.includes(start) ? [0] : [], ...side.includes(end) ? [1] : []];
          const box = () => ({ x: edge.left, y: edge.top, width: edge.right - edge.left, height: edge.bottom - edge.top });
          if (align) for (const [axis, start, end] of [["x", "left", "right"], ["y", "top", "bottom"]] as const) {
            const offset = snapOffset(box(), axis, targets, within, stops(start, end));
            if (side.includes(start)) edge[start] += offset; else if (side.includes(end)) edge[end] += offset;
          }
          if (side.includes("left")) edge.left = Math.min(edge.right - 50, edge.left);
          if (side.includes("right")) edge.right = Math.max(edge.left + 50, edge.right);
          if (side.includes("top")) edge.top = Math.min(edge.bottom - 50, edge.top);
          if (side.includes("bottom")) edge.bottom = Math.max(edge.top + 50, edge.bottom);
          if (align) found.push(...guidesFor(box(), "x", targets, stops("left", "right")), ...guidesFor(box(), "y", targets, stops("top", "bottom")));
          Object.assign(node, box());
        } else {
          dx = dx === 0 ? 0 : snap(origin.x + dx) - origin.x;
          dy = dy === 0 ? 0 : snap(origin.y + dy) - origin.y;
          if (align) {
            // The whole moving selection (a group with its cards) aligns as one box.
            const box = { x: left0 + dx, y: top0 + dy, ...span };
            for (const axis of ["x", "y"] as const) {
              if (move.shiftKey && (axis === "x" ? dx === 0 : dy === 0)) continue;
              const offset = snapOffset(box, axis, targets, within);
              box[axis] += offset;
              if (axis === "x") dx += offset; else dy += offset;
            }
            found.push(...guidesFor(box, "x", targets), ...guidesFor(box, "y", targets));
          }
          for (const [i, n] of affected.entries()) { n.x = before[i].x + dx; n.y = before[i].y + dy; }
        }
        show(found);
        // The selection is the same while it moves: only reposition its menu.
        paint(affected); menu.place();
      }, cancelled => {
        show([]);
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
  // The card a title-mode double-click just framed, when that zoom stayed zoomed out.
  let titleZoom: { id: string; scale: number } | undefined;
  el.addEventListener("dblclick", e => {
    if (!e.isTrusted || (e.target as Element).closest(".is-editing, .canvas-selection-menu")) return;
    // Zoomed out, a double-click zooms to the card instead of opening a tiny editor.
    // The next one, still on that framing, edits. A card too large to pass 55% never
    // leaves title mode, so the scale is what tells the second click from the first.
    // A group's label still edits.
    const card = nodes.find(n => n.type !== "group" && n.id === (e.target as Element).closest<HTMLElement>(".canvas-node")?.dataset.nodeId);
    if (card && world.classList.contains("is-zoomed-out")) {
      e.preventDefault(); e.stopPropagation();
      const scale = new DOMMatrix(getComputedStyle(world).transform).a;
      if (titleZoom?.id === card.id && Math.abs(titleZoom.scale - scale) < 1e-4 && !canvasReadOnly.has(el)) { titleZoom = undefined; edit(card, selection); return; }
      zoom([card]);
      const next = new DOMMatrix(getComputedStyle(world).transform).a;
      titleZoom = world.classList.contains("is-zoomed-out") ? { id: card.id, scale: next } : undefined;
      return;
    }
    titleZoom = undefined;
    if (canvasReadOnly.has(el)) return;
    const edge = edges.find(edge => edge.id === (pressedLabel ?? (e.target as Element).closest<HTMLElement>("[data-edge-id]")?.dataset.edgeId));
    if (edge) { e.preventDefault(); e.stopPropagation(); edit(edge, selection); }
    const label = (e.target as Element).closest<HTMLElement>(".canvas-group-label");
    const group = nodes.find(n => n.type === "group" && n.id === label?.parentElement?.dataset.nodeId);
    if (group) { e.preventDefault(); e.stopPropagation(); edit(group, selection); }
  }, { capture: true, signal: events.signal });
  el.addEventListener("contextmenu", e => {
    if ((e.target as Element).closest(".is-editing, .canvas-controls, .canvas-card-menu, .canvas-selection-menu")) return;
    const target = e.target as Element;
    const node = nodes.find(n => n.id === target.closest<HTMLElement>(".canvas-node")?.dataset.nodeId);
    // Empty board, including a click that merely has a selection. Edges and labels keep the selection menu.
    if (!node && !target.closest("[data-edge-id]")) {
      e.preventDefault(); e.stopPropagation();
      openBoardMenu(e.clientX, e.clientY);
      context = document.querySelector(".canvas-context-menu");
      return;
    }
    if (node && !selected.has(node.id)) { selected.clear(); selectedEdges.clear(); selected.add(node.id); selection(); }
    if (!selected.size && !selectedEdges.size) return;
    e.preventDefault(); e.stopPropagation();
    const editable = node && (node.type === "group" || node.type === "text" || node.type === "file" && isNoteFile(node.file ?? ""));
    const writable = !canvasReadOnly.has(el);
    showMenu([
      { title: "Zoom to selection", icon: "scan-search", action: menu.zoom },
      !node && writable && selected.size > 0 && { title: "Create group", icon: "group", action: createGroup },
      editable && writable && { title: node.type === "group" ? "Edit label" : "Edit", icon: "square-pen", action: () => edit(node, selection) },
      SEPARATOR, writable && { title: node ? "Remove" : "Delete", icon: "trash-2", action: removeSelected },
    ], { x: e.clientX, y: e.clientY }, { className: "canvas-context-menu" });
    context = document.querySelector(".canvas-context-menu");
  }, { signal: events.signal });
  el.addEventListener("click", e => { if (suppress) { e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true, signal: events.signal });
  el.addEventListener("keydown", e => {
    if ((e.target as Element).closest("input, textarea, [contenteditable=true], [contenteditable=plaintext-only]")) return;
    if (e.shiftKey && e.code === "Digit2") { e.preventDefault(); menu.zoom(); return; }
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
  return () => { cancel?.(); events.abort(); if (context?.isConnected) closeMenu(); menu.dispose(); };
}
