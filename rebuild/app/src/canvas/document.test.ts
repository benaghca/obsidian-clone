import { expect, test } from "vitest";
import { editCanvas } from "./document";
import { readCanvas } from "./model";

test("color edits preserve record order and unknown fields; default removes only color", () => {
  const source = '{"future":42,"nodes":[{"id":"a","type":"text","color":"1","x":0,"y":0,"width":100,"height":80,"future":{"keep":true}}],"edges":[]}';
  const node = readCanvas(source).nodes[0];
  node.color = "#123abc";
  const changed = editCanvas(source, [node]);
  expect(JSON.parse(changed).nodes[0]).toEqual({ ...JSON.parse(source).nodes[0], color: "#123abc" });
  expect(Object.keys(JSON.parse(changed))).toEqual(["future", "nodes", "edges"]);
  node.color = undefined;
  expect(JSON.parse(editCanvas(changed, [node])).nodes[0]).not.toHaveProperty("color");
});

test("moving a card preserves a future color value the rendering projection cannot read", () => {
  const source = '{"nodes":[{"id":"a","type":"text","color":{"future":true},"x":0,"y":0,"width":100,"height":80}],"edges":[]}';
  const node = readCanvas(source).nodes[0]; node.x = 20;
  expect(JSON.parse(editCanvas(source, [node])).nodes[0].color).toEqual({ future: true });
});

test("new edges use native key order and implicit default arrowheads", () => {
  const edge = { id: "0123456789abcdef", fromNode: "a", fromSide: "right", toNode: "b", toSide: "top" } as const;
  const text = editCanvas('{"nodes":[],"edges":[],"future":[1,2]}', [], undefined, [], [edge]);
  expect(text).toContain('\t\t{"id":"0123456789abcdef","fromNode":"a","fromSide":"right","toNode":"b","toSide":"top"}');
  expect(text.endsWith("\n")).toBe(false);
  expect(JSON.parse(text).future).toEqual([1, 2]);
});

test("reconnecting patches only endpoints, preserving metadata and key order", () => {
  const source = '{"nodes":[],"edges":[{"future":{"keep":true},"id":"e","fromNode":"a","fromSide":"right","toNode":"b","toSide":"left","fromEnd":"arrow","toEnd":"none","label":"Keep","color":"#123abc"},null,{"id":"future","kind":"unknown"}]}';
  const original = JSON.parse(source);
  const edge = { ...original.edges[0], toNode: "c", toSide: "bottom" };
  const result = JSON.parse(editCanvas(source, [], undefined, [], [edge]));
  expect(result.edges).toEqual([edge, null, original.edges[2]]);
  expect(Object.keys(result.edges[0])).toEqual(Object.keys(original.edges[0]));
});

test("deleting selected edges and cards retains unrelated and unknown records", () => {
  const source = '{"nodes":[{"id":"a"},{"id":"b"},null],"edges":[{"id":"e","fromNode":"a","toNode":"b"},{"id":"keep","fromNode":"a","toNode":"b","future":true},null]}';
  expect(JSON.parse(editCanvas(source, [], new Set(["e"]))).edges).toEqual([{ id: "keep", fromNode: "a", toNode: "b", future: true }, null]);
  const mixed = JSON.parse(editCanvas(source, [], new Set(["e", "b"])));
  expect(mixed.nodes).toEqual([{ id: "a" }, null]);
  expect(mixed.edges).toEqual([null]);
});
