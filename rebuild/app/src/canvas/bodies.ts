import type { CanvasNode } from "./model";
import { CanvasSpatial } from "./spatial";
import type { CanvasWork } from "./work";
import { titleBand, type CanvasViewport } from "./navigation";
interface Body { element: HTMLElement; ensure(): void; release(): void; ready(): boolean }
interface Card { node: CanvasNode; el: HTMLElement; body?: Body; last?: string }
export function canvasBodies(nodes: CanvasNode[], work: CanvasWork, viewport: () => CanvasViewport | undefined) {
  const index = new CanvasSpatial<CanvasNode>(), cards = new Map<string, Card>(), retained = new Map<string, Card>();
  nodes.forEach(n => index.update(n));
  const shown = new Set<CanvasNode>();
  let pinned = new Set<string>();
  let visible = new Set<CanvasNode>(), revision = 0, gone = false;
  const band = (el: Element, value: number) => { if (el.getAttribute("data-canvas-band") !== String(value)) { el.classList.add("canvas-band"); el.setAttribute("data-canvas-band", String(value)); } };
  function apply(card: Card, view: CanvasViewport, on: boolean) {
    if (pinned.has(card.node.id)) { on = true; if (view.titles) view = { ...view, titles: false }; }
    const { node, el, body } = card;
    if (on || el.classList.contains("is-editing")) shown.add(node); else shown.delete(node);
    card.last = `${on}/${view.band}/${view.titles}`;
    el.classList.toggle("is-culled", !on && !el.classList.contains("is-editing"));
    if (!on) { if (!el.classList.contains("is-editing")) body?.element.remove(); return; }
    el.classList.toggle("is-title-mode", view.titles);
    for (const child of el.children) if (child.matches(".canvas-node-ring,.canvas-node-title,.canvas-group-label,.canvas-node-connection-point")) band(child, view.band);
    const title = el.querySelector<HTMLElement>(".canvas-node-title"), min = titleBand(node.width, node.height);
    if (title) title.style.display = view.titles && min !== undefined && view.band < min ? "none" : "";
    const wanted = !view.titles || el.classList.contains("is-image") || el.classList.contains("is-editing");
    if (body && !wanted) body.element.remove();
    if (body && wanted) {
      if (body.element.parentElement !== el) el.append(body.element);
      body.ensure();
      if (body.ready()) { retained.delete(node.id); retained.set(node.id, card); }
    }
    el.classList.toggle("is-body-pending", !!body && wanted && !body.ready());
  }
  function update() {
    if (gone) return;
    const view = viewport(); if (!view) return;
    const token = ++revision, next = new Set(index.query({ x: view.x - view.width / 4, y: view.y - view.height / 4, width: view.width * 1.5, height: view.height * 1.5 }));
    for (const id of pinned) { const card = cards.get(id); if (card) next.add(card.node); }
    const ordered = [...next].sort((a, b) => Math.hypot(a.x + a.width / 2 - view.focusX, a.y + a.height / 2 - view.focusY) - Math.hypot(b.x + b.width / 2 - view.focusX, b.y + b.height / 2 - view.focusY));
    const enqueue = (list: CanvasNode[], on: boolean, prefix: string) => {
      const size = on && !view.titles ? 1 : 8;
      for (let i = 0; i < list.length; i += size) work.add(`${prefix}:${i}`, () => {
        if (token !== revision) return;
        for (const node of list.slice(i, i + size)) { const card = cards.get(node.id); if (card) apply(card, view, on); }
      });
    };
    enqueue([...shown].filter(node => !next.has(node)), false, "body-hide");
    enqueue(ordered.filter(node => { const card = cards.get(node.id); return card && (card.last !== `true/${view.band}/${view.titles}` || card.body && (!view.titles || card.el.classList.contains("is-image")) && !card.body.ready()); }), true, "body-show");
    visible = next;
    trim();
  }
  function trim() {
    work.add(retained, () => {
      for (const [id, card] of retained) {
        if (retained.size <= 300) break;
        if (visible.has(card.node) || card.el.classList.contains("is-editing")) continue;
        card.body?.release(); retained.delete(id);
      }
    });
  }
  function prepare(card: Card) {
    const {node,el,body} = card; const view = viewport(); if (view) { const on = node.x <= view.x + view.width * 1.25 && node.x + node.width >= view.x - view.width / 4 && node.y <= view.y + view.height * 1.25 && node.y + node.height >= view.y - view.height / 4; el.classList.toggle("is-culled", !on && !el.classList.contains("is-editing")); el.classList.toggle("is-title-mode", view.titles); for (const child of el.children) if (child.matches(".canvas-node-ring,.canvas-node-title,.canvas-group-label")) band(child, view.band);
      const title = el.querySelector<HTMLElement>(".canvas-node-title"), min = titleBand(node.width, node.height);
      if (title && view.titles && min !== undefined && view.band < min) title.style.display = "none";
      if ((!on || view.titles && !el.classList.contains("is-image")) && !el.classList.contains("is-editing")) body?.element.remove();
      card.last = `${on}/${view.band}/${view.titles}`; if (on) { shown.add(node); visible.add(node); } else shown.delete(node);
    } else shown.add(node);
  }
  function present(ids: Iterable<string> | null) {
    pinned = new Set(ids ?? []);
    const view = viewport();
    if (!view || !pinned.size) return;
    for (const id of pinned) { const card = cards.get(id); if (card) apply(card, view, true); }
  }
  return { update, present,
    add(node: CanvasNode, el: HTMLElement, body?: Body) { const card = {node,el,body}; cards.set(node.id,card); prepare(card); },
    prepare(node: CanvasNode) { const card = cards.get(node.id); if (card) prepare(card); },
    changed(changed: CanvasNode[]) { changed.forEach(n => { index.update(n); const card = cards.get(n.id); if (card) card.last = undefined; }); update(); },
    ready(node: CanvasNode) { const card = cards.get(node.id); if (card && !gone) { retained.delete(node.id); retained.set(node.id, card); const view = viewport(); if (view) apply(card, view, visible.has(node)); trim(); } },
    wanted(node: CanvasNode) { const view = viewport(); return !gone && visible.has(node) && !!view && (!view.titles || cards.get(node.id)?.el.classList.contains("is-image")); },
    stats: () => ({ retained: retained.size, visible: visible.size }),
    dispose() { gone = true; revision++; for (const card of cards.values()) card.body?.release(); cards.clear(); retained.clear(); shown.clear(); visible.clear(); },
  };
}
