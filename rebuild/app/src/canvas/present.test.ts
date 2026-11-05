import { expect, test } from "vitest";
import type { CanvasNode } from "./model";
import { easeInOutCubic, glideCamera, presentAction, slideFrame, slideMembers, stepIndex } from "./present";

const card = (id: string, x: number, y: number, width = 100, height = 80, extra: Partial<CanvasNode> = {}): CanvasNode =>
  ({ id, type: "text", x, y, width, height, ...extra });

test("slideFrame fits a labeled group and clamps a small card at 4", () => {
  const group = card("g", 0, 0, 100, 100, { type: "group", label: "G" });
  const framed = slideFrame(group, 1100, 1100)!;
  expect(framed.scale).toBe(4);
  expect(framed.cx).toBe(50);
  expect(framed.cy).toBe(-36 + 136 / 2);
  const plain = slideFrame(card("t", 0, 0, 100, 100), 1100, 1100)!;
  expect(plain.cy).toBe(50);
  const huge = slideFrame(card("h", 0, 0, 8000, 5000), 1280, 1000)!;
  expect(huge.scale).toBeCloseTo(1280 / (8000 * 1.1));
  expect(huge.scale).toBeLessThan(0.45);
  expect(slideFrame(card("z", 0, 0), 0, 100)).toBeNull();
});

test("slideMembers keeps a card, and a group plus what sits fully inside it", () => {
  const group = card("g", 0, 0, 200, 200, { type: "group" });
  const inside = card("a", 10, 10, 40, 40);
  const edge = card("b", 180, 10, 40, 40);
  const nodes = [group, inside, edge, card("c", 10, 10)];
  expect(slideMembers(inside, nodes).map(n => n.id)).toEqual(["a"]);
  expect(slideMembers(group, nodes).map(n => n.id)).toEqual(["g", "a", "c"]);
});

test("presentAction maps the slide keys and leaves chords alone", () => {
  expect(presentAction({ key: "ArrowRight" })).toBe("next");
  expect(presentAction({ key: " " })).toBe("next");
  expect(presentAction({ key: "Space" })).toBe("next");
  expect(presentAction({ key: "Enter" })).toBe("next");
  expect(presentAction({ key: "n" })).toBe("next");
  expect(presentAction({ key: "ArrowLeft" })).toBe("prev");
  expect(presentAction({ key: "Backspace" })).toBe("prev");
  expect(presentAction({ key: "p" })).toBe("prev");
  expect(presentAction({ key: "Home" })).toBe("first");
  expect(presentAction({ key: "End" })).toBe("last");
  expect(presentAction({ key: "Escape" })).toBe("exit");
  expect(presentAction({ key: "ArrowRight", ctrl: true })).toBe("ignore");
  expect(presentAction({ key: "p", meta: true })).toBe("ignore");
  expect(presentAction({ key: "F5" })).toBe("ignore");
  expect(presentAction({ key: "!" })).toBe("ignore");
});

test("stepIndex clamps and an empty deck stays at 0", () => {
  expect(stepIndex(0, 3, 1)).toBe(1);
  expect(stepIndex(2, 3, 1)).toBe(2);
  expect(stepIndex(0, 3, -1)).toBe(0);
  expect(stepIndex(5, 0, 1)).toBe(0);
});

test("glideCamera eases the center linearly and the zoom geometrically", () => {
  const from = { cx: 0, cy: 10, scale: 1 }, to = { cx: 100, cy: 10, scale: 4 };
  expect(glideCamera(from, to, 0)).toEqual(from);
  expect(glideCamera(from, to, 1)).toEqual(to);
  const mid = glideCamera(from, to, 0.5);
  expect(mid.cx).toBe(50);
  expect(mid.cy).toBe(10);
  expect(mid.scale).toBeCloseTo(2);
  expect(glideCamera({ cx: 1, cy: 1, scale: 3 }, { cx: 9, cy: 5, scale: 3 }, 0.25).scale).toBeCloseTo(3);
  expect(easeInOutCubic(0)).toBe(0);
  expect(easeInOutCubic(1)).toBe(1);
  expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
});
