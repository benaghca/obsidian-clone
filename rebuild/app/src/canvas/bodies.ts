import type { CanvasNode } from "./model";
import { CanvasSpatial } from "./spatial";
import type { CanvasWork } from "./work";
import { titleBand, type CanvasViewport } from "./navigation";
import { webFrameSlots, type WebFrameCard } from "./webFrames";

interface Body {
  element: HTMLElement;
  ensure(): void;
  release(): void;
  ready(): boolean;
  /** A link card. Released when it loses its frame slot, so a detached page unloads. */
  frame?: boolean;
  wantsFrame?: () => boolean;
}
interface Card { node: CanvasNode; el: HTMLElement; body?: Body; last?: string }
export function canvasBodies(nodes: CanvasNode[], work: CanvasWork, viewport: () => CanvasViewport | undefined) {
  const index = new CanvasSpatial<CanvasNode>(), cards = new Map<string, Card>(), retained = new Map<string, Card>();
  nodes.forEach(n => index.update(n));
  const shown = new Set<CanvasNode>();
  let pinned = new Set<string>();
  const frameCards = new Set<string>();
  let frameOrder: string[] = [], frameIds = new Set<string>(), preferredFrame: string | undefined;
  let visible = new Set<CanvasNode>(), revision = 0, gone = false;
  const band = (el: Element, value: number) => { if (el.getAttribute("data-canvas-band") !== String(value)) { el.classList.add("canvas-band"); el.setAttribute("data-canvas-band", String(value)); } };
  const mark = (on: boolean, view: CanvasViewport, id: string) => `${on}/${view.band}/${view.titles}${frameIds.has(id) ? "/1" : ""}`;
  // One integer check when the board has no link cards. Slots change only when the set does.
  function assignFrames(view: CanvasViewport) {
    if (frameCards.size === 0) return;
    const list: WebFrameCard[] = [];
    for (const id of frameCards) {
      const card = cards.get(id);
      const body = card?.body;
      if (!card || !body?.frame) continue;
      const node = card.node;
      list.push({ id, x: node.x, y: node.y, width: node.width, height: node.height, wants: body.wantsFrame?.() ?? false });
    }
    const prior = preferredFrame ? [...frameOrder.filter(id => id !== preferredFrame), preferredFrame] : frameOrder;
    preferredFrame = undefined;
    const next = webFrameSlots(list, view, prior);
    if (next.length === frameOrder.length && next.every((id, i) => id === frameOrder[i])) return;
    const nextIds = new Set(next);
    for (const id of frameOrder) {
      if (!nextIds.has(id)) cards.get(id)?.body?.release();
    }
    frameOrder = next;
    frameIds = nextIds;
  }
  function unload(card: Card) {
    if (card.body?.frame && !frameIds.has(card.node.id)) card.body.release();
  }
  // A presented slide is drawn as itself while the board is still zoomed out.
  function slideView(id: string, view: CanvasViewport) {
    return pinned.has(id) && view.titles ? { ...view, titles: false } : view;
  }
  function apply(card: Card, view: CanvasViewport, on: boolean) {
    view = slideView(card.node.id, view);
    if (pinned.has(card.node.id)) on = true;
    const { node, el, body } = card;
    unload(card);
    if (on || el.classList.contains("is-editing")) shown.add(node); else shown.delete(node);
    card.last = mark(on, view, node.id);
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
    assignFrames(view);
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
    enqueue(ordered.filter(node => {
      const card = cards.get(node.id); if (!card) return false;
      const shown = slideView(node.id, view);
      return card.last !== mark(true, shown, node.id) || !!(card.body && (!shown.titles || card.el.classList.contains("is-image")) && !card.body.ready());
    }), true, "body-show");
    visible = next;
    trim();
  }
  function trim() {
    work.add(retained, () => {
      for (const [id, card] of retained) {
        if (retained.size <= 300) break;
        if (pinned.has(id) || visible.has(card.node) || card.el.classList.contains("is-editing")) continue;
        card.body?.release(); retained.delete(id);
      }
    });
  }
  function prepare(card: Card) {
    const {node,el,body} = card; const view = viewport(); if (view) { const on = node.x <= view.x + view.width * 1.25 && node.x + node.width >= view.x - view.width / 4 && node.y <= view.y + view.height * 1.25 && node.y + node.height >= view.y - view.height / 4; unload(card); el.classList.toggle("is-culled", !on && !el.classList.contains("is-editing")); el.classList.toggle("is-title-mode", view.titles); for (const child of el.children) if (child.matches(".canvas-node-ring,.canvas-node-title,.canvas-group-label")) band(child, view.band);
      const title = el.querySelector<HTMLElement>(".canvas-node-title"), min = titleBand(node.width, node.height);
      if (title && view.titles && min !== undefined && view.band < min) title.style.display = "none";
      if ((!on || view.titles && !el.classList.contains("is-image")) && !el.classList.contains("is-editing")) body?.element.remove();
      // No slot bit here. The first update of a slotted card mismatches and applies; other cards keep this key.
      card.last = `${on}/${view.band}/${view.titles}`; if (on) { shown.add(node); visible.add(node); } else shown.delete(node);
    } else shown.add(node);
  }
  function present(ids: Iterable<string> | null) {
    pinned = new Set(ids ?? []);
    const view = viewport();
    if (!view || !pinned.size) return;
    for (const id of pinned) {
      const card = cards.get(id);
      if (!card) continue;
      // Mark it visible before ensure(), so a file or drawing read that finishes
      // during the call is kept, and the body cache does not evict the slide.
      visible.add(card.node);
      apply(card, view, true);
    }
  }
  return { update, present,
    add(node: CanvasNode, el: HTMLElement, body?: Body) { const card = {node,el,body}; cards.set(node.id,card); if (body?.frame) frameCards.add(node.id); prepare(card); },
    prepare(node: CanvasNode) { const card = cards.get(node.id); if (card) prepare(card); },
    changed(changed: CanvasNode[]) { changed.forEach(n => { index.update(n); const card = cards.get(n.id); if (card) card.last = undefined; }); update(); },
    ready(node: CanvasNode) { const card = cards.get(node.id); if (card && !gone) { retained.delete(node.id); retained.set(node.id, card); const view = viewport(); if (view) apply(card, view, visible.has(node)); trim(); } },
    // A presented slide stays wanted after the camera drops into title mode, and
    // while it is still outside the viewport the glide has not reached.
    wanted(node: CanvasNode) {
      if (gone) return false;
      if (pinned.has(node.id)) return true;
      const view = viewport();
      return !!view && visible.has(node) && (!view.titles || !!cards.get(node.id)?.el.classList.contains("is-image"));
    },
    slotted: (id: string) => frameIds.has(id),
    recheck(prefer?: string) {
      if (gone) return;
      if (prefer) preferredFrame = prefer;
      for (const card of cards.values()) card.last = undefined;
      update();
    },
    stats: () => ({ retained: retained.size, visible: visible.size, frames: frameIds.size }),
    dispose() { gone = true; revision++; pinned = new Set(); for (const card of cards.values()) card.body?.release(); cards.clear(); retained.clear(); shown.clear(); visible.clear(); frameCards.clear(); frameOrder = []; frameIds = new Set(); preferredFrame = undefined; },
  };
}
