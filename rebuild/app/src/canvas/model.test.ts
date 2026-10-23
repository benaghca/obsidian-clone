import { expect, test } from "vitest";
import { closestSide, edgeCurve, readCanvas } from "./model";

test("projects damaged and future canvases without modifying the input", () => {
  for (const source of ["", "{", "{}", "null", "[]", '{"nodes":[null,{}, {"id":"future","type":"future"}],"edges":[null]}']) expect(readCanvas(source)).toEqual({ nodes: [], edges: [] });
  const source = '{"unknown":42,"nodes":[{"id":"a","type":"text","text":"Hello","extra":[1,2]},{"id":"b","type":"file","file":"Note.md","width":-10}],"edges":[{"id":"ok","fromNode":"a","toNode":"b"},{"id":"bad","fromNode":"a","toNode":"future"}]}';
  const board = readCanvas(source);
  expect(board.nodes[0]).toMatchObject({ text: "Hello", x: 0, y: 0, width: 250, height: 200 });
  expect(board.nodes[1].width).toBe(1);
  expect(board.edges.map(e => e.id)).toEqual(["ok"]);
  expect(JSON.parse(source).nodes[0].extra).toEqual([1, 2]);
});

test("edges accept every side combination and tolerate invalid sides", () => {
  const { nodes } = readCanvas('{"nodes":[{"id":"a","type":"text"},{"id":"b","type":"text","x":500,"y":300}]}');
  for (const fromSide of ["top", "right", "bottom", "left", "__proto__", 2]) for (const toSide of ["top", "right", "bottom", "left", "unknown"]) {
    const curve = edgeCurve(nodes[0], nodes[1], { id: "e", fromNode: "a", toNode: "b", fromSide, toSide } as never);
    expect(curve.path).not.toMatch(/NaN|undefined|Infinity/);
    expect(Number.isFinite(curve.x) && Number.isFinite(curve.y)).toBe(true);
  }
});


test("omitted edge sides face the other card in every direction; explicit sides win", () => {
  const a = { id: "a", type: "text", x: 100, y: 520, width: 200, height: 100 } as const;
  const edge = { id: "e", fromNode: "a", toNode: "b" };
  for (const [x, y, start, end] of [
    [100, 780, "M200,620 ", "L200,780"], [100, 260, "M200,520 ", "L200,360"],
    [500, 520, "M300,570 ", "L500,570"], [-300, 520, "M100,570 ", "L-100,570"],
  ] as const) {
    const curve = edgeCurve(a, { ...a, id: "b", x, y }, edge).path;
    expect(curve.startsWith(start) && curve.endsWith(end)).toBe(true);
  }
  expect(edgeCurve(a, { ...a, y: 780 }, { ...edge, fromSide: "left", toSide: "right" }).path).toMatch(/^M100,570 .*L300,830$/);
});

test("connection sides snap to the nearest border, including the center tie", () => {
  const n = { id: "a", type: "text", x: 100, y: 50, width: 220, height: 140 } as const;
  expect(closestSide(n, 210, 120)).toBe("top");
  for (const [x, y, side] of [[102, 100, "left"], [318, 100, "right"], [180, 52, "top"], [180, 188, "bottom"]] as const)
    expect(closestSide(n, x, y)).toBe(side);
});
