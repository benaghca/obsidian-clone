import type { CanvasEdge, CanvasNode } from "./model";

/** Groups when the board has any, otherwise every card, plus where to open. */
export interface SlideOrder {
  /** The board's own nodes, in presentation order. */
  slides: CanvasNode[];
  /** First selected slide. 0 when the selection names no slide. */
  start: number;
}

/**
 * Presentation order.
 * Slides are the groups, or the cards when there are no groups. An edge
 * between two slides points from `fromNode` to `toNode`; arrowhead flags
 * are not read. The walk starts at the earliest slide in reading order
 * that an arrow leaves and none enters, then takes the unread successor
 * earliest in reading order. A slide is never repeated, so a cycle ends
 * the walk. Whatever the arrows did not reach stays in reading order.
 * Reading order is rows: scanning downward, a slide joins the current row
 * when its top is above that row's first slide's midline, and the row
 * then runs left to right. Equal positions keep node order.
 */
export function slideOrder(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[], selected: Iterable<string> = []): SlideOrder {
  const groups = nodes.filter((n) => n.type === "group");
  const slides = orderSlides(groups.length ? groups : nodes, edges);
  return { slides, start: startIndex(slides, selected) };
}

function orderSlides(items: readonly CanvasNode[], edges: readonly CanvasEdge[]): CanvasNode[] {
  const reading = readingOrder(items);
  const ids = new Set(reading.map((n) => n.id));
  const next = new Map<string, string[]>();
  const incoming = new Set<string>();
  for (const edge of edges) {
    if (!ids.has(edge.fromNode) || !ids.has(edge.toNode) || edge.fromNode === edge.toNode) continue;
    const out = next.get(edge.fromNode);
    if (out) out.push(edge.toNode);
    else next.set(edge.fromNode, [edge.toNode]);
    incoming.add(edge.toNode);
  }
  if (!next.size) return reading;
  const byId = new Map(reading.map((n) => [n.id, n]));
  const rank = new Map(reading.map((n, i) => [n.id, i]));
  const slides: CanvasNode[] = [];
  const seen = new Set<string>();
  const walk = (id: string | undefined) => {
    while (id && !seen.has(id)) {
      seen.add(id);
      const node = byId.get(id);
      if (node) slides.push(node);
      const ahead = (next.get(id) ?? []).filter((to) => !seen.has(to));
      ahead.sort((a, b) => rank.get(a)! - rank.get(b)!);
      id = ahead[0];
    }
  };
  walk(reading.find((n) => next.has(n.id) && !incoming.has(n.id))?.id ?? reading[0]?.id);
  for (const node of reading) if (!seen.has(node.id)) walk(node.id);
  return slides;
}

/** Rows by y, then x within a row. The row's height is its first slide's height. */
function readingOrder(items: readonly CanvasNode[]): CanvasNode[] {
  const byY = items.slice().sort((a, b) => a.y - b.y);
  const rows: { top: number; height: number; items: CanvasNode[] }[] = [];
  for (const node of byY) {
    const row = rows[rows.length - 1];
    if (row && node.y < row.top + row.height * 0.5) row.items.push(node);
    else rows.push({ top: node.y, height: node.height, items: [node] });
  }
  return rows.flatMap((row) => row.items.sort((a, b) => a.x - b.x));
}

function startIndex(slides: readonly CanvasNode[], selected: Iterable<string>): number {
  for (const id of selected) {
    const index = slides.findIndex((node) => node.id === id);
    if (index >= 0) return index;
  }
  return 0;
}
