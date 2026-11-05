// Test-only: writes fixtures/drawings/cinder-*.excalidraw with Cinder's own
// drawing model (ui/draw-render.js at the repo root), so the X1 file model is
// checked against files Cinder's editor really saves. Nothing from Cinder is
// imported by the app; rerun this only to refresh the fixtures:
//   node scripts/gen-drawing-fixtures.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../fixtures/drawings");

// Cinder takes ids, seeds and nonces from Math.random and times from
// Date.now; pin both so the fixtures are the same on every run.
let state = 12345;
Math.random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
let clock = Date.UTC(2026, 9, 19, 9, 0, 0);
Date.now = () => (clock += 1000);

const S = createRequire(import.meta.url)("../../../ui/draw-render.js");

function save(name, build) {
  const scene = S.emptyScene();
  build(scene);
  writeFileSync(join(out, `cinder-${name}.excalidraw`), S.serializeDrawing(scene, { format: "json" }));
}

// A new, empty drawing, as "New drawing" makes it.
save("empty", () => {});

// One element of each type Cinder's toolbar makes, with its default fields.
save("shapes", scene => {
  const add = (type, props) => { const el = S.newElement(type, props); scene.elements.push(el); return el; };
  add("rectangle", { x: 10, y: 20, width: 160, height: 90, roundness: { type: 3 }, backgroundColor: "#a5d8ff", fillStyle: "hachure" });
  add("diamond", { x: 220, y: 20, width: 120, height: 120, strokeStyle: "dashed", roundness: { type: 2 } });
  add("ellipse", { x: 400, y: 20, width: 140, height: 90, fillStyle: "cross-hatch", backgroundColor: "#ffc9c9", opacity: 60, angle: 0.4 });
  const line = add("line", { x: 10, y: 200, width: 200, height: 60, strokeStyle: "dotted" });
  line.points = [[0, 0], [80, 60], [200, 10]];
  const pen = add("freedraw", { x: 260, y: 200, width: 90, height: 40, strokeWidth: 1 });
  pen.points = [[0, 0], [10, 5], [25, 18], [40, 30], [60, 38], [90, 40]];
  pen.pressures = [0.2, 0.4, 0.5, 0.6, 0.5, 0.3];
  pen.simulatePressure = false;
  add("text", { x: 400, y: 200, width: 120, height: 25, text: "Hello, drawing", originalText: "Hello, drawing", fontSize: 20, fontFamily: 1 });
  add("frame", { x: 0, y: 0, width: 600, height: 300, name: "Board" });
});

// Text inside a shape, and an arrow bound to two shapes with a label.
save("bindings", scene => {
  const a = S.newElement("rectangle", { x: 0, y: 0, width: 160, height: 80, roundness: { type: 3 } });
  const b = S.newElement("ellipse", { x: 360, y: 0, width: 140, height: 80 });
  const label = S.newElement("text", { x: 30, y: 27, width: 100, height: 25, text: "Start", originalText: "Start", textAlign: "center", verticalAlign: "middle", containerId: a.id, autoResize: true });
  const arrow = S.newElement("arrow", { x: 165, y: 40, width: 190, height: 0, roundness: { type: 2 } });
  arrow.points = [[0, 0], [190, 0]];
  arrow.startBinding = { elementId: a.id, focus: 0, gap: 5 };
  arrow.endBinding = { elementId: b.id, focus: 0.1, gap: 5 };
  arrow.startArrowhead = "dot";
  const tag = S.newElement("text", { x: 230, y: 28, width: 60, height: 25, text: "next", originalText: "next", fontSize: 16, fontFamily: 3, textAlign: "center", verticalAlign: "middle", containerId: arrow.id });
  a.boundElements = [{ type: "text", id: label.id }, { type: "arrow", id: arrow.id }];
  b.boundElements = [{ type: "arrow", id: arrow.id }];
  arrow.boundElements = [{ type: "text", id: tag.id }];
  scene.elements.push(a, b, label, arrow, tag);
});

// A pasted image, with its file entry.
save("image", scene => {
  const img = S.newElement("image", { x: 40, y: 40, width: 64, height: 64, fileId: "f0e1d2c3b4a5" });
  img.link = "[[Some note]]";
  scene.elements.push(img);
  scene.files = { f0e1d2c3b4a5: { mimeType: "image/png", id: "f0e1d2c3b4a5", dataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", created: 1760864400000 } };
  scene.appState.viewBackgroundColor = "#fdfdf6";
});

console.log("wrote fixtures/drawings/cinder-*.excalidraw");
