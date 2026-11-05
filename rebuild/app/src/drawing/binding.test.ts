import { describe, expect, it } from "vitest";
import {
  arrowsBoundTo, BIND_GAP, bindPoints, bindTargetAt, deletePatches, followArrows, insideTarget, outlinePoint, Patches,
  sceneLookup, setBinding, targetOf, unbindLeft, type Target,
} from "./binding";
import { DrawingHistory } from "./history";
import { worldPoints } from "./linear";
import { findElement, parseScene, serializeScene, type DrawingElement, type LinearElement, type Point, type Scene } from "./scene";
import { movedPatch } from "./transform";

const fixtures = import.meta.glob<string>("../../fixtures/drawings/*.excalidraw", { eager: true, query: "?raw", import: "default" });
const fixture = (name: string) => fixtures[`../../fixtures/drawings/${name}.excalidraw`];

function sceneOf(list: Record<string, unknown>[]): Scene {
  const parsed = parseScene(JSON.stringify({ type: "excalidraw", version: 2, elements: list }, null, 2));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.scene;
}
const open = (text: string) => { const p = parseScene(text); if (!p.ok) throw new Error(p.error); return p.scene; };
const find = (s: Scene) => (id: string) => findElement(s, id);
const close = (a: Point, b: Point, digits = 4) => { expect(a[0]).toBeCloseTo(b[0], digits); expect(a[1]).toBeCloseTo(b[1], digits); };
const box = (type: string, x: number, y: number, width: number, height: number, angle = 0): Target => ({ id: type, type, frame: { x, y, width, height, angle } });
const stamp = () => { let t = 1000, r = 0; return { now: () => ++t, random: () => (r = (r * 9301 + 49297) % 233280) / 233280 }; };

describe("outline points", () => {
  it("meets a rectangle's side on the way to its centre, short by the gap", () => {
    close(outlinePoint(box("rectangle", 0, 0, 100, 50), [200, 25], 0)!, [100, 25]);
    close(outlinePoint(box("rectangle", 0, 0, 100, 50), [200, 25], 4)!, [104, 25]);
    // From above and to the side: the top edge comes first.
    close(outlinePoint(box("rectangle", 0, 0, 100, 50), [50, -100], 0)!, [50, 0]);
  });

  it("meets an ellipse and a diamond on their own outlines", () => {
    close(outlinePoint(box("ellipse", 0, 0, 100, 50), [50, -100], 0)!, [50, 0]);
    const diagonal = outlinePoint(box("ellipse", -50, -50, 100, 100), [100, 100], 0)!;
    close(diagonal, [50 * Math.SQRT1_2, 50 * Math.SQRT1_2]);
    // A diamond's side halfway between its tips.
    close(outlinePoint(box("diamond", -50, -50, 100, 100), [100, 100], 0)!, [25, 25]);
  });

  it("follows a turned shape", () => {
    // A 100x20 bar turned upright: its long side now runs down the screen.
    const p = outlinePoint(box("rectangle", -50, -10, 100, 20, Math.PI / 2), [0, -200], 0)!;
    close(p, [0, -50]);
  });

  it("has no point when the aim starts inside", () => {
    expect(outlinePoint(box("rectangle", 0, 0, 100, 50), [50, 25.5], 0)).toBeNull();
    expect(outlinePoint(box("ellipse", 0, 0, 100, 50), [60, 30], 4)).toBeNull();
  });

  it("knows inside from outside, with a margin", () => {
    const e = box("ellipse", 0, 0, 100, 50);
    expect(insideTarget(e, [50, 25])).toBe(true);
    expect(insideTarget(e, [2, 2])).toBe(false);
    expect(insideTarget(box("diamond", 0, 0, 100, 100), [10, 10])).toBe(false);
    expect(insideTarget(box("rectangle", 0, 0, 100, 50), [103, 25], 4)).toBe(true);
  });
});

describe("bind targets", () => {
  const scene = sceneOf([
    { id: "low", type: "rectangle", x: 0, y: 0, width: 200, height: 200 },
    { id: "high", type: "ellipse", x: 50, y: 50, width: 100, height: 100 },
    { id: "label", type: "text", x: 80, y: 90, width: 40, height: 20, text: "hi", containerId: "high" },
    { id: "free", type: "text", x: 300, y: 0, width: 40, height: 20, text: "note" },
    { id: "gone", type: "rectangle", x: 500, y: 0, width: 50, height: 50, isDeleted: true },
    { id: "line", type: "line", x: 0, y: 300, points: [[0, 0], [100, 0]] },
  ]);
  it("takes the topmost shape under the end", () => {
    expect(bindTargetAt(scene.elements, [100, 100], 0)?.id).toBe("high");
    expect(bindTargetAt(scene.elements, [10, 10], 0)?.id).toBe("low");
    expect(bindTargetAt(scene.elements, [310, 10], 0)?.id).toBe("free");
  });
  it("skips labels, lines, deleted shapes and what the caller leaves out", () => {
    expect(bindTargetAt(scene.elements, [525, 25], 0)).toBeNull();
    expect(bindTargetAt(scene.elements, [50, 300], 2)).toBeNull();
    expect(bindTargetAt(scene.elements, [100, 100], 0, (e) => e.id === "high")?.id).toBe("low");
  });
});

describe("bound ends", () => {
  it("aims a two-point arrow from centre to centre", () => {
    const a = box("rectangle", 0, 0, 100, 100);
    const b = box("rectangle", 300, 0, 100, 100);
    const pts = bindPoints([[50, 50], [350, 50]], a, b, 0, 0);
    close(pts[0], [100, 50]);
    close(pts[1], [300, 50]);
  });
  it("aims each end of a longer arrow at its neighbour", () => {
    const b = box("ellipse", 300, 0, 100, 100);
    const pts = bindPoints([[0, 0], [350, -100], [350, 50]], null, b, 0, BIND_GAP);
    close(pts[2], [350, 0 - BIND_GAP]);
    close(pts[0], [0, 0]);
  });
});

describe("arrows that follow their shapes", () => {
  const list = () => sceneOf([
    { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 100, boundElements: [{ type: "arrow", id: "arr" }] },
    { id: "b", type: "rectangle", x: 300, y: 0, width: 100, height: 100, boundElements: [{ type: "arrow", id: "arr" }] },
    { id: "arr", type: "arrow", x: 104, y: 50, width: 192, height: 0, points: [[0, 0], [192, 0]],
      startBinding: { elementId: "a", focus: 0, gap: 4 }, endBinding: { elementId: "b", focus: 0, gap: 4 } },
    { id: "tag", type: "text", x: 180, y: 40, width: 40, height: 20, text: "go", containerId: "arr" },
  ]);

  it("finds arrows by their own bindings", () => {
    const s = list();
    expect(arrowsBoundTo(s, new Set(["b"])).map((e) => e.id)).toEqual(["arr"]);
    expect(arrowsBoundTo(s, new Set(["tag"]))).toEqual([]);
  });

  it("moves the bound end with its shape and the label to the new middle", () => {
    const s = list();
    const arrow = findElement(s, "arr")!;
    const patches = followArrows(s, [arrow], sceneLookup(find(s), new Set(["b"]), 0, 200));
    const p = patches.get("arr")!;
    const pts = (p.points as Point[]).map(([x, y]) => [x + (p.x as number), y + (p.y as number)] as Point);
    // b's centre is now (350, 250): both ends sit on the line between the centres, 4 short of each box.
    const u: Point = [300 / Math.hypot(300, 200), 200 / Math.hypot(300, 200)];
    close(pts[0], [100 + 4 * u[0], 50 + 50 / 1.5 + 4 * u[1]], 3);
    close(pts[1], [300 - 4 * u[0], 250 - 50 / 1.5 - 4 * u[1]], 3);
    const tag = patches.get("tag")!;
    expect((tag.x as number) + 20).toBeCloseTo((pts[0][0] + pts[1][0]) / 2, 3);
    expect(p.angle).toBe(0);
  });

  it("leaves an arrow alone when none of its shapes can be found", () => {
    const s = list();
    expect(followArrows(s, [findElement(s, "arr")!], () => null).size).toBe(0);
  });

  it("binds and unbinds with both lists kept right", () => {
    const s = list();
    const arrow = findElement(s, "arr")!;
    const out = new Patches();
    setBinding(arrow, "end", findElement(s, "a")!, find(s), out);
    expect(out.get("arr")).toEqual({ endBinding: { elementId: "a", focus: 0, gap: BIND_GAP } });
    expect(out.get("b")).toEqual({ boundElements: null });
    // a already lists the arrow (its start), so it isn't added twice.
    expect(out.has("a")).toBe(false);
    // Both ends on one shape: letting go of one keeps the shape's entry, letting go of both drops it.
    const s2 = sceneOf([
      { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 100, boundElements: [{ type: "arrow", id: "arr" }, { type: "text", id: "t" }] },
      { id: "arr", type: "arrow", points: [[0, 0], [10, 0], [10, 10]], startBinding: { elementId: "a", focus: 0, gap: 4 }, endBinding: { elementId: "a", focus: 0, gap: 4 } },
    ]);
    const one = setBinding(findElement(s2, "arr")!, "start", null, find(s2));
    expect(one.has("a")).toBe(false);
    const both = unbindLeft([findElement(s2, "arr")!], new Set(), find(s2));
    expect(both.get("arr")).toEqual({ startBinding: null, endBinding: null });
    expect(both.get("a")).toEqual({ boundElements: [{ type: "text", id: "t" }] });
  });

  it("lets go of shapes that stayed behind", () => {
    const s = list();
    const out = unbindLeft([findElement(s, "arr")!], new Set(["arr", "a"]), find(s));
    expect(out.get("arr")).toEqual({ endBinding: null });
    expect(out.get("b")).toEqual({ boundElements: null });
    expect(out.has("a")).toBe(false);
  });

  it("deletes a shape with its label and frees the arrows bound to it", () => {
    const s = sceneOf([
      { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 100, boundElements: [{ type: "arrow", id: "arr" }, { type: "text", id: "l" }] },
      { id: "l", type: "text", x: 30, y: 40, width: 40, height: 20, text: "box", containerId: "a" },
      { id: "b", type: "rectangle", x: 300, y: 0, width: 100, height: 100, boundElements: [{ type: "arrow", id: "arr" }] },
      { id: "arr", type: "arrow", points: [[0, 0], [10, 0]], startBinding: { elementId: "a", focus: 0, gap: 4 }, endBinding: { elementId: "b", focus: 0, gap: 4 } },
    ]);
    const { patches, gone } = deletePatches(s, ["a"], find(s));
    expect([...gone].sort()).toEqual(["a", "l"]);
    expect(patches.get("a")).toEqual({ isDeleted: true });
    expect(patches.get("l")).toEqual({ isDeleted: true });
    expect(patches.get("arr")).toEqual({ startBinding: null });
    expect(patches.has("b")).toBe(false);
    // Deleting the arrow takes it off both shapes' lists.
    const arrow = deletePatches(s, ["arr"], find(s)).patches;
    expect(arrow.get("a")).toEqual({ boundElements: [{ type: "text", id: "l" }] });
    expect(arrow.get("b")).toEqual({ boundElements: null });
  });
});

describe("a Cinder drawing after an edit", () => {
  it("moves a bound shape, its label and its arrow, and keeps every other byte", () => {
    const text = fixture("cinder-bindings");
    const scene = open(text);
    const rect = scene.elements.find((e) => e.type === "rectangle")!;
    const label = scene.elements.find((e) => e.type === "text" && (e as DrawingElement & { containerId: string | null }).containerId === rect.id)!;
    const arrow = scene.elements.find((e) => e.type === "arrow")! as DrawingElement & LinearElement;
    const untouched = scene.elements.filter((e) => e.id !== rect.id && e.id !== label.id && e.id !== arrow.id).map((e) => e.id);
    const tag = scene.elements.find((e) => e.type === "text" && (e as DrawingElement & { containerId: string | null }).containerId === arrow.id)!;

    // Views read their record, and an edit changes the record: keep what we compare with.
    const was = { rectY: rect.y, labelY: label.y, tagY: tag.y, version: arrow.version, start: arrow.startBinding, end: arrow.endBinding, head: arrow.startArrowhead };
    const history = new DrawingHistory(stamp());
    const tx = history.begin(scene, [rect.id]);
    const moving = new Set([rect.id, label.id]);
    tx.update(rect.id, movedPatch(rect, 0, 120));
    tx.update(label.id, movedPatch(label, 0, 120));
    for (const [id, patch] of followArrows(scene, arrowsBoundTo(scene, moving), sceneLookup((id) => findElement(scene, id)))) tx.merge(id, patch);
    expect(tx.commit([rect.id])).toBe(true);
    const saved = serializeScene(scene);

    const again = open(saved);
    const before = JSON.parse(text), after = JSON.parse(saved);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(after.appState).toEqual(before.appState);
    expect(after.files).toEqual(before.files);
    // Elements nothing touched are the same bytes, in the same order.
    for (const id of untouched.filter((id) => id !== tag.id)) {
      const raw = (doc: { elements: { id: string }[] }) => JSON.stringify(doc.elements.find((e) => e.id === id), null, 2);
      expect(raw(after)).toBe(raw(before));
      expect(saved).toContain(raw(before).split("\n").join("\n    "));
    }
    expect(after.elements.map((e: { id: string }) => e.id)).toEqual(before.elements.map((e: { id: string }) => e.id));
    // The arrow keeps its bindings, focus and heads, and its start now sits on the moved box.
    const moved = findElement(again, arrow.id) as DrawingElement & LinearElement;
    expect(moved.startBinding).toEqual(was.start);
    expect(moved.endBinding).toEqual(was.end);
    expect(moved.startArrowhead).toBe(was.head);
    expect(Object.keys(after.elements.find((e: { id: string }) => e.id === arrow.id))).toEqual(Object.keys(before.elements.find((e: { id: string }) => e.id === arrow.id)));
    const start = worldPoints(moved)[0];
    const r = findElement(again, rect.id)!;
    expect(r.y).toBe(was.rectY + 120);
    expect(insideTarget(targetOf(r), start, was.start!.gap + 0.01)).toBe(true);
    expect(insideTarget(targetOf(r), start, was.start!.gap - 0.5)).toBe(false);
    expect(moved.version).toBe(was.version + 1);
    // The arrow's own label went to its new middle; the box's label went with the box.
    expect(findElement(again, tag.id)!.y).not.toBe(was.tagY);
    expect(findElement(again, label.id)!.y).toBe(was.labelY + 120);
    // Undo writes the file as it was.
    history.undo(scene);
    expect(serializeScene(scene)).toBe(text);
  });
});
