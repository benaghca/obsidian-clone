import { expect, test } from "vitest";
import type { CanvasEdge, CanvasNode } from "./model";
import { slideOrder } from "./slides";

function node(id: string, type: CanvasNode["type"], x: number, y: number, width = 200, height = 160): CanvasNode {
  return { id, type, x, y, width, height };
}
function edge(fromNode: string, toNode: string, extra: Partial<CanvasEdge> = {}): CanvasEdge {
  return { id: `${fromNode}>${toNode}`, fromNode, toNode, ...extra };
}
function presented(nodes: readonly CanvasNode[], edges: readonly CanvasEdge[] = [], selected?: Iterable<string>) {
  const order = slideOrder(nodes, edges, selected);
  return { ids: order.slides.map((n) => n.id), start: order.start, slides: order.slides };
}

test("no groups: cards in reading order, and an arrow between cards leads", () => {
  // a is highest, but b shares its row (b.y is above a's midline) and is further left.
  const a = node("a", "text", 300, 0, 200, 200);
  const b = node("b", "file", 0, 40, 180, 120);
  // Exactly on a's midline: the next row, not this one.
  const c = node("c", "link", 20, 100, 200, 80);
  const d = node("d", "text", 40, 260);
  const cards = [a, b, c, d];
  expect(presented(cards)).toEqual({ ids: ["b", "a", "c", "d"], start: 0, slides: [b, a, c, d] });
  // A missing id is skipped. The first selected card wins, in selection order.
  expect(presented(cards, [], ["gone", "a", "b"])).toMatchObject({ ids: ["b", "a", "c", "d"], start: 1 });
  // c → b, so the walk leaves c, follows to b, then picks up a and d in reading order.
  expect(presented(cards, [edge("c", "b")]).ids).toEqual(["c", "b", "a", "d"]);
});

test("a chain of groups follows the arrows, ahead of cards and of reading order", () => {
  const c = node("c", "group", 0, 0);
  const a = node("a", "group", 280, 0);
  const b = node("b", "group", 560, 0);
  const card = node("card", "text", 0, 400);
  const groups = [c, a, b, card];
  // Reading order would be c, a, b. The only source is a.
  const chain = presented(groups, [edge("a", "b"), edge("b", "c")], ["b"]);
  expect(chain.ids).toEqual(["a", "b", "c"]);
  expect(chain.slides[1]).toBe(b);
  expect(chain.start).toBe(1);
  // A card is not a slide while any group exists, so selecting it opens at the start.
  expect(presented(groups, [edge("a", "b"), edge("b", "c")], ["card"]).start).toBe(0);
  // Two separate chains are each walked whole. A topological interleave would be a, b, c, d.
  const two = ["a", "b", "c", "d"].map((id, i) => node(id, "group", i * 200, 0));
  expect(presented(two, [edge("a", "c"), edge("b", "d")]).ids).toEqual(["a", "c", "b", "d"]);
  // A line with no heads still has a direction. Ignoring it would leave reading order c, a, b.
  const plain = [node("c", "group", 0, 0), node("a", "group", 280, 0), node("b", "group", 560, 0)];
  expect(presented(plain, [edge("a", "b", { toEnd: "none" })]).ids).toEqual(["a", "b", "c"]);
  // A two-headed edge points fromNode → toNode. Treating the start head as a back-edge would open on b.
  const both = [node("b", "group", 0, 0), node("a", "group", 300, 0)];
  expect(presented(both, [edge("a", "b", { fromEnd: "arrow", toEnd: "arrow" })]).ids).toEqual(["a", "b"]);
});

test("a branch takes the successor earliest in reading order", () => {
  const a = node("a", "group", 0, 0);
  const b = node("b", "group", 240, 0);
  const c = node("c", "group", 480, 0);
  // The c edge is listed first. Reading order still takes b before c.
  const branch = presented([a, b, c], [edge("a", "c"), edge("a", "b")], ["c", "a"]);
  expect(branch.ids).toEqual(["a", "b", "c"]);
  expect(branch.start).toBe(2);
  // A join follows the first chain through the shared slide, then the other predecessor.
  expect(presented([a, b, c], [edge("a", "c"), edge("b", "c")]).ids).toEqual(["a", "c", "b"]);
});

test("a cycle is walked once from the reading-order start", () => {
  const a = node("a", "group", 0, 0);
  const b = node("b", "group", 240, 0);
  const c = node("c", "group", 480, 0);
  const d = node("d", "group", 720, 0);
  // No source: every slide of the cycle has an arrow in. Start at a, follow a → c → b, and stop.
  const cycle = presented([a, b, c, d], [edge("a", "c"), edge("c", "b"), edge("b", "a")], ["c"]);
  expect(cycle.ids).toEqual(["a", "c", "b", "d"]);
  expect(cycle.start).toBe(1);
  // A self-arrow is not a cycle and does not move anyone.
  expect(presented([a, b], [edge("a", "a")]).ids).toEqual(["a", "b"]);
});

test("nested groups are slides, and an arrow between them leads", () => {
  const outer = node("outer", "group", 0, 0, 900, 500);
  const inner = node("inner", "group", 80, 60, 300, 200);
  const right = node("right", "group", 980, 20, 200, 200);
  const below = node("below", "group", 40, 520, 400, 180);
  const inside = node("inside", "text", 100, 100);
  const outside = node("outside", "file", 200, 40);
  const board = [outer, inner, right, below, inside, outside];
  // inner is above outer's midline, so it shares that row and follows by x. below starts the next row.
  expect(presented(board).ids).toEqual(["outer", "inner", "right", "below"]);
  // The card → group edge is not an arrow between slides. inner → outer is.
  const linked = presented(board, [edge("inner", "outer"), edge("inside", "below")], ["inside", "below"]);
  expect(linked.ids).toEqual(["inner", "outer", "right", "below"]);
  expect(linked.slides).toEqual([inner, outer, right, below]);
  expect(linked.start).toBe(3);
  expect(presented(board, [edge("inner", "outer")], ["inner"]).start).toBe(0);
});

test("an empty board has no slides and starts at 0", () => {
  expect(presented([])).toEqual({ ids: [], start: 0, slides: [] });
  expect(presented([], [edge("a", "b")], ["a"])).toEqual({ ids: [], start: 0, slides: [] });
});

test("an empty-string slide id is retained when following arrows", () => {
  // readCanvas accepts any string id, including an empty string.
  const blank = node("", "group", 0, 0);
  const a = node("a", "group", 240, 0);
  const b = node("b", "group", 480, 0);
  expect(presented([blank, a, b], [edge("a", ""), edge("", "b")], [""]))
    .toMatchObject({ ids: ["a", "", "b"], start: 1 });
  expect(presented([blank, a], [edge("", "a")]).ids).toEqual(["", "a"]);
});
