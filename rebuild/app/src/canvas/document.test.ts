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
