import { expect, test } from "vitest";
import { CanvasSpatial } from "./spatial";
test("spatial queries follow mutation, removal, negative coordinates and shared buckets", () => {
  const index = new CanvasSpatial<{ x: number; y: number; width: number; height: number }>();
  const a = { x: -200, y: 0, width: 300, height: 100 }, b = { x: 100, y: 0, width: 80, height: 100 };
  index.update(a); index.update(b);
  expect(index.query({ x: 90, y: 20, width: 50, height: 20 })).toEqual([a, b]);
  a.x = 5000; index.update(a);
  expect(index.query({ x: 90, y: 20, width: 50, height: 20 })).toEqual([b]);
  index.remove(b); expect(index.query({ x: -1000, y: -1000, width: 2000, height: 2000 })).toEqual([]);
});
test("huge groups and a sparse fit do not walk the empty world", () => {
  const index = new CanvasSpatial<{ x: number; y: number; width: number; height: number }>();
  const group = { x: -1e9, y: -1e9, width: 2e9, height: 2e9 }, far = { x: 1e12, y: 1e12, width: 250, height: 160 };
  index.update(group); index.update(far);
  expect(new Set(index.query({ x: -1e12, y: -1e12, width: 3e12, height: 3e12 }))).toEqual(new Set([group, far]));
  expect(index.query({ x: 0, y: 0, width: 10, height: 10 })).toEqual([group]);
  index.remove(group); expect(index.query({ x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
});
