import { expect, test } from "vitest";
import { edgeCurve, readCanvas } from "./model";

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
