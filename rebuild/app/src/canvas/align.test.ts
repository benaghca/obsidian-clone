import { expect, test } from "vitest";
import { alignTargets, guidesFor, snapOffset } from "./align";

const a = { x: 0, y: 0, width: 400, height: 400 };
const b = { x: 480, y: 0, width: 400, height: 400 };

test("snaps an edge or the center to the nearest line within the distance, else not at all", () => {
  const targets = alignTargets([a]);
  // Top edge 4 below a's top: snaps up by 4.
  expect(snapOffset({ ...b, y: 4 }, "y", targets, 6)).toBe(-4);
  // 7 away is too far at 6.
  expect(snapOffset({ ...b, y: 7 }, "y", targets, 6)).toBe(0);
  // Center to center: a 100-high box whose middle is 3 above a's middle (200).
  expect(snapOffset({ x: 480, y: 147, width: 100, height: 100 }, "y", targets, 6)).toBe(3);
  // The nearer of two candidates wins: right edge 2 short of a's center (200) beats left edge 5 past a's left.
  expect(snapOffset({ x: 5, y: 600, width: 193, height: 10 }, "x", targets, 6)).toBe(2);
});

test("the snap distance is in board units, so callers scale it by zoom", () => {
  const targets = alignTargets([a]);
  // 10 board units off: too far at 100% zoom (6 / 1), close enough at 50% (6 / .5 = 12).
  expect(snapOffset({ ...b, y: 10 }, "y", targets, 6 / 1)).toBe(0);
  expect(snapOffset({ ...b, y: 10 }, "y", targets, 6 / 0.5)).toBe(-10);
});

test("boxes without a size (unknown node types) are not targets", () => {
  const targets = alignTargets([a, { x: 500, y: Number.NaN, width: Number.NaN, height: Number.NaN }]);
  expect(targets.x.every((line) => Number.isFinite(line.at))).toBe(true);
  expect(targets.x).toHaveLength(3);
});

test("guides join aligned edges corner to corner and centers center to center", () => {
  const guides = guidesFor(b, "y", alignTargets([a]));
  // Top edges, middles and bottom edges all line up (same height): three horizontal guides.
  expect(guides.map((g) => g.at)).toEqual([0, 200, 400]);
  const top = guides[0];
  expect(top).toEqual({ axis: "y", at: 0, from: 0, to: 880, dots: [480, 880, 0, 400] });
  const middle = guides[1];
  expect([middle.from, middle.to, middle.dots]).toEqual([200, 680, [680, 200]]);
  // Nothing lines up vertically.
  expect(guidesFor(b, "x", alignTargets([a]))).toEqual([]);
});

test("a resized edge can snap and guide on its own", () => {
  const targets = alignTargets([a]);
  // Dragging b's bottom edge to 403: only the end edge (k = 1) is considered.
  const resized = { ...b, height: 403 };
  expect(snapOffset(resized, "y", targets, 6, [1])).toBe(-3);
  expect(guidesFor({ ...b, height: 400 }, "y", targets, [1]).map((g) => g.at)).toEqual([400]);
});

test("finds the nearest line among 300 cards", () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ x: (i % 20) * 280, y: Math.floor(i / 20) * 190, width: 250, height: 160 }));
  const targets = alignTargets(many);
  expect(targets.x).toHaveLength(900);
  // Left edge 3 past column 7's left (1960): snaps back by 3.
  expect(snapOffset({ x: 1963, y: 5000, width: 10, height: 10 }, "x", targets, 6)).toBe(-3);
  // Between column 7's left (1960) and center (2085), far from both: no snap.
  expect(snapOffset({ x: 2023, y: 5000, width: 0, height: 0 }, "x", targets, 6)).toBe(0);
});
