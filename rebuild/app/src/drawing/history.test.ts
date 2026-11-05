import { describe, expect, it } from "vitest";
import { DrawingHistory } from "./history";
import { findElement, parseScene, serializeScene, type Scene } from "./scene";

const stamp = () => {
  let t = 1000, r = 0;
  return { now: () => ++t, random: () => (r = (r * 9301 + 49297) % 233280) / 233280 };
};

const source = JSON.stringify({
  type: "excalidraw", version: 2, source: "cinder",
  elements: [
    { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, version: 3, versionNonce: 7, updated: 5, customKey: { keep: true } },
    { id: "m", type: "math", x: 0, y: 0, latex: "x^2" },
    { id: "b", type: "ellipse", x: 50, y: 0, width: 10, height: 10, version: 1 },
  ],
  appState: { viewBackgroundColor: "#ffffff", theme: "light" },
  files: {},
  extraTopLevel: 1,
}, null, 2) + "\n";

function open(): Scene {
  const parsed = parseScene(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.scene;
}

describe("drawing history", () => {
  it("records one step per transaction and undoes back to the original bytes", () => {
    const scene = open();
    const history = new DrawingHistory(stamp());
    const tx = history.begin(scene, []);
    for (let i = 1; i <= 20; i++) tx.preview("a", { x: i, y: i * 2 });
    expect(findElement(scene, "a")!.version).toBe(3);
    expect(tx.commit(["a"])).toBe(true);
    const a = findElement(scene, "a")!;
    expect([a.x, a.y, a.version]).toEqual([20, 40, 4]);
    expect(a.raw.customKey).toEqual({ keep: true });
    expect(history.canUndo).toBe(true);

    const add = history.begin(scene, ["a"]);
    const c = add.add("diamond", { x: 5, y: 5, width: 30, height: 30 });
    add.preview(c.id, { width: 40 });
    add.commit([c.id]);
    expect(scene.elements.map((e) => e.id)).toEqual(["a", "m", "b", c.id]);

    expect(history.undo(scene)).toEqual(["a"]);
    expect(scene.elements.map((e) => e.id)).toEqual(["a", "m", "b"]);
    expect(history.undo(scene)).toEqual([]);
    expect(scene.dirty).toBe(false);
    expect(serializeScene(scene)).toBe(source);
    expect(history.undo(scene)).toBeNull();

    expect(history.redo(scene)).toEqual(["a"]);
    expect(findElement(scene, "a")!.x).toBe(20);
    expect(history.redo(scene)).toEqual([c.id]);
    expect(findElement(scene, c.id)!.width).toBe(40);
    expect(scene.dirty).toBe(true);
    const saved = JSON.parse(serializeScene(scene));
    expect(saved.extraTopLevel).toBe(1);
    expect(saved.appState.theme).toBe("light");
    expect(saved.elements[1]).toEqual({ id: "m", type: "math", x: 0, y: 0, latex: "x^2" });
  });

  it("a new transaction clears redo", () => {
    const scene = open();
    const history = new DrawingHistory(stamp());
    const tx = history.begin(scene, []);
    tx.update("a", { x: 1 });
    tx.commit([]);
    history.undo(scene);
    expect(history.canRedo).toBe(true);
    const next = history.begin(scene, []);
    next.update("b", { x: 99 });
    next.commit([]);
    expect(history.canRedo).toBe(false);
  });

  it("cancel puts records back and drops additions", () => {
    const scene = open();
    const history = new DrawingHistory(stamp());
    const tx = history.begin(scene, []);
    tx.preview("a", { x: 500 });
    tx.update("b", { strokeColor: "#ff0000" });
    tx.add("rectangle", { x: 1, y: 1 });
    tx.cancel();
    expect(scene.elements.map((e) => e.id)).toEqual(["a", "m", "b"]);
    expect(findElement(scene, "a")!.x).toBe(0);
    expect(scene.dirty).toBe(false);
    expect(serializeScene(scene)).toBe(source);
    expect(history.canUndo).toBe(false);
  });

  it("a transaction that changes nothing records nothing", () => {
    const scene = open();
    const history = new DrawingHistory(stamp());
    const tx = history.begin(scene, []);
    tx.preview("a", { x: 5 });
    tx.preview("a", { x: 0 });
    expect(tx.commit([])).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(scene.dirty).toBe(false);
    expect(serializeScene(scene)).toBe(source);
  });

  it("a later live frame drops fields an earlier one set", () => {
    const scene = open();
    const history = new DrawingHistory(stamp());
    const tx = history.begin(scene, []);
    tx.preview("a", { x: 5, angle: 1 });
    tx.preview("a", { x: 6 });
    tx.commit([]);
    const a = findElement(scene, "a")!;
    expect([a.x, a.angle, a.version]).toEqual([6, 0, 4]);
  });
});
