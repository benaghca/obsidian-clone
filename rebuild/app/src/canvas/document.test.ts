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
  expect(JSON.parse(editCanvas(source, [], undefined, [], [], new Set(["e"]))).edges).toEqual([{ id: "keep", fromNode: "a", toNode: "b", future: true }, null]);
  const mixed = JSON.parse(editCanvas(source, [], new Set(["b"]), [], [], new Set(["e"])));
  expect(mixed.nodes).toEqual([{ id: "a" }, null]);
  expect(mixed.edges).toEqual([null]);
});

test("card and edge IDs have independent deletion namespaces", () => {
  const source = '{"nodes":[{"id":"same"},{"id":"b"},{"id":"c"}],"edges":[{"id":"same","fromNode":"b","toNode":"c"}]}';
  expect(JSON.parse(editCanvas(source, [], new Set(["same"]))).edges).toHaveLength(1);
  expect(JSON.parse(editCanvas(source, [], undefined, [], [], new Set(["same"]))).nodes).toHaveLength(3);
});

test("group labels preserve unknown metadata/order and an empty label removes its key", () => {
  const source = '{"future":42,"nodes":[{"future":{"keep":true},"id":"g","type":"group","label":"Old","x":0,"y":0,"width":400,"height":300,"tail":true}],"edges":[]}';
  const node = readCanvas(source).nodes[0]; node.label = "New";
  const changed = JSON.parse(editCanvas(source, [node])).nodes[0];
  expect(changed).toEqual({ ...JSON.parse(source).nodes[0], label: "New" });
  expect(Object.keys(changed)).toEqual(Object.keys(JSON.parse(source).nodes[0]));
  node.label = "";
  expect(JSON.parse(editCanvas(source, [node])).nodes[0]).not.toHaveProperty("label");
});

test("new groups precede existing cards without changing their raw fields or unknown labels", () => {
  const source = '{"nodes":[{"id":"a","type":"text","future":42},{"id":"g","type":"group","label":{"future":true},"x":0,"y":0,"width":100,"height":80}],"edges":[],"tail":true}';
  const group = { id: "new", x: -20, y: -20, width: 140, height: 120, type: "group" as const, label: "Untitled group" };
  const moved = readCanvas(source).nodes.find(n => n.id === "g")!; moved.x = 20;
  const result = JSON.parse(editCanvas(source, [moved], undefined, [group]));
  expect(result.nodes[0]).toEqual(group);
  expect(result.nodes[1]).toEqual(JSON.parse(source).nodes[0]);
  expect(result.nodes[2].label).toEqual({ future: true });
  expect(Object.keys(result)).toEqual(["nodes", "edges", "tail"]);
});

test("edge metadata inserts native keys without moving unknown fields, and removes defaults", () => {
  const source = '{"nodes":[],"edges":[{"future":42,"id":"e","fromNode":"a","toNode":"b","label":"Old","tail":true}]}';
  const edge = { ...JSON.parse(source).edges[0], fromEnd: "arrow", color: "#123abc", label: "New" };
  const changed = JSON.parse(editCanvas(source, [], undefined, [], [edge])).edges[0];
  expect(Object.keys(changed)).toEqual(["future", "id", "fromNode", "toNode", "fromEnd", "color", "label", "tail"]);
  expect(changed).toEqual({ ...edge });
  const cleared = JSON.parse(editCanvas(JSON.stringify({ edges: [changed] }), [], undefined, [], [{ ...edge, fromEnd: undefined, toEnd: "none", color: undefined, label: "" }])).edges[0];
  expect(cleared).toEqual({ future: 42, id: "e", fromNode: "a", toNode: "b", toEnd: "none", tail: true });
});
