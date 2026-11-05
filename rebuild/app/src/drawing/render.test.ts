import { describe, expect, it } from "vitest";
import { parseScene, updateElement, type Scene } from "./scene";
import { drawingColor, openDrawingImages, renderDrawing, type RenderOptions } from "./render";

const fixtures = import.meta.glob<string>("../../fixtures/drawings/*.excalidraw", { eager: true, query: "?raw", import: "default" });
const fixture = (name: string) => fixtures[`../../fixtures/drawings/${name}.excalidraw`];

function open(text: string): Scene {
  const result = parseScene(text);
  if (!result.ok) throw new Error(result.error);
  return result.scene;
}

function draw(name: string, opts: RenderOptions = {}) {
  const scene = open(fixture(name));
  return renderDrawing(scene, { images: (id) => (scene.files.has(id) ? `blob:drawing/${id}` : undefined), ...opts });
}

function sceneOf(elements: unknown[], files: Record<string, unknown> = {}) {
  return open(JSON.stringify({ type: "excalidraw", version: 2, elements, appState: { viewBackgroundColor: "#ffffff" }, files }));
}

describe("svg snapshots", () => {
  for (const [path, text] of Object.entries(fixtures)) {
    const name = path.split("/").pop()!;
    it(name, () => {
      const scene = open(text);
      const picture = renderDrawing(scene, { images: (id) => (scene.files.has(id) ? `blob:drawing/${id}` : undefined) });
      expect(picture.markup).not.toContain("base64");
      expect(picture.markup.replaceAll("http://www.w3.org/2000/svg", "")).not.toMatch(/https?:/i);
      expect(picture.markup).toBe(picture.shell.replace("</svg>", `${picture.chunks.join("")}</svg>`));
      expect(picture.markup).toMatchSnapshot();
    });
  }

  it("cinder-shapes in dark mode", () => {
    const picture = draw("cinder-shapes", { dark: true });
    expect(picture.markup).toContain("#a5d8ff");
    expect(picture.markup).not.toContain("#ffffff");
    expect(picture.markup).not.toContain("#1e1e1e");
    expect(picture.markup).toMatchSnapshot();
  });
});

describe("drawingColor", () => {
  it("darkens near-white, lightens near-black, and leaves a hachure blue", () => {
    expect(drawingColor("#ffffff", true)).not.toBe("#ffffff");
    expect(drawingColor("#1e1e1e", true)).not.toBe("#1e1e1e");
    expect(drawingColor("#fdfdf6", true)).not.toBe("#fdfdf6");
    expect(drawingColor("#fffce8", true)).not.toBe("#fffce8");
    expect(drawingColor("#a5d8ff", true)).toBe("#a5d8ff");
    expect(drawingColor("transparent", true)).toBe("transparent");
    expect(drawingColor("#a5d8ff", false)).toBe("#a5d8ff");
  });
});

describe("shapes", () => {
  it("escapes file-supplied paint attributes", () => {
    const color = '#fff"/><foreignObject data-injected="yes';
    const markup = renderDrawing(sceneOf([
      { id: "r", type: "rectangle", strokeColor: color, backgroundColor: color },
      { id: "t", type: "text", text: "safe", strokeColor: color },
      { id: "a", type: "arrow", strokeColor: color, points: [[0, 0], [100, 0]] },
    ])).markup;
    expect(markup).not.toContain("<foreignObject");
    expect(markup).toContain("&quot;/&gt;&lt;foreignObject");
  });

  it("distinguishes open arrowheads from filled triangles", () => {
    const markup = renderDrawing(sceneOf([
      { id: "a", type: "arrow", points: [[0, 0], [100, 0]], endArrowhead: "arrow" },
      { id: "t", type: "arrow", points: [[0, 20], [100, 20]], endArrowhead: "triangle" },
    ])).markup;
    const heads = [...markup.matchAll(/<path data-part="end"[^>]+/g)].map(m => m[0]);
    expect(heads[0]).toContain('fill="none"');
    expect(heads[0]).not.toContain(' Z');
    expect(heads[1]).toContain('fill="#1e1e1e"');
    expect(heads[1]).toContain(' Z');
  });

  it("draws the cinder shapes", () => {
    const markup = draw("cinder-shapes").markup;
    expect(markup).toMatch(/data-id="BBhn4Geh"[^>]* rx="/);
    expect(markup).toMatch(/data-id="BBhn4Geh"[^>]* fill="url\(#/);
    expect(markup).toMatch(/data-id="Cu7ErcY7"[^>]* d="[^"]*Q/);
    expect(markup).toMatch(/data-id="Cu7ErcY7"[^>]* stroke-dasharray="/);
    expect(markup).toMatch(/data-id="9paeRapJ"[^>]* opacity="0.6"/);
    expect(markup).toContain("rotate(22.92 ");
    expect(markup).toMatch(/data-id="TAcSj7Aw"[^>]* stroke-dasharray="/);
    expect(markup).toMatch(/data-id="7hpomJ5v"[^>]* d="[^"]* C/);
    expect(markup).toContain("Hello, drawing");
    expect(markup).toContain(">Board<");
    expect(markup.indexOf('data-id="Y5uIqVWx"')).toBeLessThan(markup.indexOf('data-id="BBhn4Geh"'));
    expect(markup).toContain("#a5d8ff");
  });

  it("draws bindings, arrowheads and the two font stacks", () => {
    const markup = draw("cinder-bindings").markup;
    const arrow = markup.slice(markup.indexOf('data-id="LR2YwsFt"'), markup.indexOf('data-id="N4YMqy9A"'));
    expect(arrow).toContain('data-part="start"');
    expect(arrow).toContain('data-part="end"');
    expect(arrow).toContain("<circle ");
    expect(markup).toContain("cursive");
    expect(markup).toContain("JetBrains Mono");
    expect(markup).toContain("monospace");
    expect(markup).toContain(">next<");
    expect(markup).toContain(">Start<");
  });

  it("keeps a legacy end arrow and reads draw as a line", () => {
    const markup = draw("legacy").markup;
    const arrow = markup.slice(markup.indexOf('data-id="old-arrow"'), markup.indexOf('data-id="old-draw"'));
    expect(arrow).toContain('data-part="end"');
    expect(markup).toContain('data-id="old-draw" data-type="line"');
  });

  it("skips a deleted element and labels an unknown one", () => {
    const markup = draw("excalidraw-web").markup;
    expect(markup).not.toContain("gone-1");
    expect(markup).toContain('data-id="emb-1" data-type="embeddable"');
    expect(markup).toContain(">embeddable<");
    expect(markup).toContain("second line");
    expect(markup).toContain('href="blob:drawing/6a1f0c9e2b7d4e8f"');
    expect(markup).toContain("scale(-1 1)");
    expect(markup).not.toContain("example.com");
  });

  it("points an image at the given href", () => {
    const markup = draw("cinder-image").markup;
    expect(markup).toContain('href="blob:drawing/f0e1d2c3b4a5"');
    expect(markup).not.toContain("base64");
    expect(markup).not.toContain("[[");
  });

  it("ignores roughness", () => {
    const scene = open(fixture("cinder-shapes"));
    const first = renderDrawing(scene).markup;
    updateElement(scene, "BBhn4Geh", { roughness: 3 });
    expect(renderDrawing(scene).markup).toBe(first);
  });

  it("hatches zigzag with its own pattern", () => {
    const markup = renderDrawing(sceneOf([
      { id: "z", type: "rectangle", x: 0, y: 0, width: 40, height: 30, backgroundColor: "#ffd43b", fillStyle: "zigzag", strokeColor: "#1e1e1e" },
    ])).markup;
    expect(markup).toContain("<pattern ");
    expect(markup).toMatch(/data-id="z"[^>]* fill="url\(#/);
  });

  it("clips a fractional crop and ignores a pixel crop", () => {
    const file = { f: { mimeType: "image/png", dataURL: "data:image/png;base64,AAAA" } };
    const fractional = renderDrawing(sceneOf([
      { id: "im", type: "image", x: 0, y: 0, width: 80, height: 40, fileId: "f", crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 } },
    ], file), { images: () => "blob:drawing/f" }).markup;
    expect(fractional).toContain("<clipPath ");
    expect(fractional).toContain('href="blob:drawing/f"');
    expect(fractional).not.toContain("base64");
    const pixels = renderDrawing(sceneOf([
      { id: "im", type: "image", x: 0, y: 0, width: 80, height: 40, fileId: "f", crop: { x: 10, y: 10, width: 20, height: 20 } },
    ], file), { images: () => "blob:drawing/f" }).markup;
    expect(pixels).not.toContain("clipPath");
  });

  it("keeps an elbowed arrow sharp and draws a zero-size math element as a box", () => {
    const elbow = renderDrawing(sceneOf([
      { id: "e", type: "arrow", x: 0, y: 0, width: 40, height: 20, points: [[0, 0], [20, 20], [40, 0]], roundness: { type: 2 }, elbowed: true, endArrowhead: "bar" },
    ])).markup;
    const shaft = elbow.slice(elbow.indexOf('data-part="shaft"'), elbow.indexOf('data-part="end"'));
    expect(shaft).toContain(" L");
    expect(shaft).not.toContain(" C");
    const math = renderDrawing(sceneOf([{ id: "m", type: "math", x: 5, y: 6, width: 0, height: 0 }])).markup;
    expect(math).toContain('data-type="math"');
    expect(math).toContain(">math<");
    expect(math).toContain('width="160"');
    expect(math).toContain('height="80"');
  });

  it("sizes an embed and can leave the height flexible", () => {
    const sized = draw("cinder-empty", { width: 400 }).markup;
    expect(sized).toMatch(/<svg[^>]* width="400"/);
    expect(sized).toMatch(/<svg[^>]* height="/);
    const flex = draw("cinder-empty", { flexHeight: true }).markup;
    expect(flex).toMatch(/<svg[^>]* width="/);
    expect(flex).not.toMatch(/<svg[^>]* height="/);
    expect(draw("cinder-empty", { paper: false }).markup).not.toContain('data-part="paper"');
  });

  it("opens image bytes as object URLs", () => {
    const images = openDrawingImages(open(fixture("cinder-image")));
    const href = images.href("f0e1d2c3b4a5");
    expect(href).toMatch(/^blob:/);
    images.revoke();
    expect(images.href("f0e1d2c3b4a5")).toBeUndefined();
  });
});

function covers(box: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  expect(box.x).toBeLessThanOrEqual(x);
  expect(box.y).toBeLessThanOrEqual(y);
  expect(box.x + box.width).toBeGreaterThanOrEqual(x);
  expect(box.y + box.height).toBeGreaterThanOrEqual(y);
}

function headPoints(markup: string): Array<[number, number]> {
  const head = markup.slice(markup.indexOf('data-part="end"'));
  const d = head.match(/\bd="([^"]+)"/);
  if (d) {
    const nums = [...d[1].matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  }
  const circle = head.match(/\bcx="([^"]+)" cy="([^"]+)" r="([^"]+)"/);
  if (circle) {
    const cx = Number(circle[1]), cy = Number(circle[2]), r = Number(circle[3]);
    return [[cx - r, cy], [cx + r, cy], [cx, cy - r], [cx, cy + r]];
  }
  const line = head.match(/\bx1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/);
  if (line) return [[Number(line[1]), Number(line[2])], [Number(line[3]), Number(line[4])]];
  throw new Error(head.slice(0, 180));
}

describe("point geometry", () => {
  const line = {
    id: "ln", type: "line", x: 300, y: 200, width: 200, height: 100, angle: 0, strokeWidth: 2,
    points: [[0, 0], [-200, -100]],
  };
  const arrow = {
    id: "ar", type: "arrow", x: 300, y: 200, width: 200, height: 100, angle: Math.PI / 2, strokeWidth: 2,
    points: [[0, 0], [-200, -100]], endArrowhead: "arrow",
  };
  const freedraw = {
    id: "fd", type: "freedraw", x: 0, y: 0, width: 10, height: 10, angle: Math.PI / 2, strokeWidth: 2,
    points: [[0, 0], [-80, 20], [-20, -60]],
  };

  it("fits a line whose points run up and left of the stored box", () => {
    const picture = renderDrawing(sceneOf([line]));
    expect(picture.bounds).toEqual({ x: 99, y: 99, width: 202, height: 102 });
    expect(picture.viewBox).toEqual({ x: 83, y: 83, width: 234, height: 134 });
    expect(picture.markup).not.toContain("rotate(");
    expect(picture.markup).toContain("M300 200 L100 100");
  });

  it("turns a leftward arrow about the centre of its points", () => {
    const picture = renderDrawing(sceneOf([arrow]));
    expect(picture.markup).toContain("rotate(90 200 150)");
    expect(picture.markup).not.toContain("400 250");
    covers(picture.bounds, 150, 250);
    covers(picture.bounds, 250, 50);
    covers(picture.viewBox, 150, 250);
    covers(picture.viewBox, 250, 50);
  });

  it("turns a freedraw stroke about its points and keeps the negative end", () => {
    const picture = renderDrawing(sceneOf([freedraw]));
    expect(picture.markup).toContain("rotate(90 -40 -20)");
    expect(picture.markup).not.toContain("rotate(90 5 5)");
    for (const [x, y] of [[-60, 20], [-80, -60], [0, 0]]) covers(picture.bounds, x, y);
  });

  it("includes the bulge of a smoothed stroke past the point box", () => {
    const points = [[0, 0], [0, 60], [60, 60]];
    const freedrawPicture = renderDrawing(sceneOf([
      { id: "fd", type: "freedraw", x: 0, y: 0, width: 60, height: 60, strokeWidth: 2, points },
    ]));
    const linePicture = renderDrawing(sceneOf([
      { id: "ln", type: "line", x: 0, y: 0, width: 60, height: 60, strokeWidth: 2, points, roundness: { type: 2 } },
    ]));
    // The cubic reaches x = -40/9. Half the stroke sits outside that.
    for (const picture of [freedrawPicture, linePicture]) {
      expect(picture.bounds.x).toBeCloseTo(-40 / 9 - 1, 5);
      expect(picture.bounds.y).toBeCloseTo(-1, 5);
      expect(picture.bounds.width).toBeCloseTo(62 + 40 / 9, 5);
      expect(picture.bounds.height).toBeCloseTo(62 + 40 / 9, 5);
    }
    const elbow = renderDrawing(sceneOf([
      { id: "ar", type: "arrow", x: 0, y: 0, width: 60, height: 60, strokeWidth: 2, points, roundness: { type: 2 }, elbowed: true, endArrowhead: null },
    ]));
    expect(elbow.bounds.x).toBeCloseTo(-1, 5);
    expect(elbow.bounds.y).toBeCloseTo(-1, 5);
  });

  it("rotates that bulge about the point centre, not the ink centre", () => {
    const picture = renderDrawing(sceneOf([
      { id: "fd", type: "freedraw", x: 0, y: 0, width: 60, height: 60, angle: Math.PI / 2, strokeWidth: 2, points: [[0, 0], [0, 60], [60, 60]] },
    ]));
    expect(picture.markup).toContain("rotate(90 30 30)");
    expect(picture.bounds.x).toBeCloseTo(-1 - 40 / 9, 5);
    expect(picture.bounds.y).toBeCloseTo(-1 - 40 / 9, 5);
    expect(picture.bounds.width).toBeCloseTo(62 + 40 / 9, 5);
    expect(picture.bounds.height).toBeCloseTo(62 + 40 / 9, 5);
  });

  it("includes arrowheads that leave a flat point box", () => {
    for (const kind of ["arrow", "triangle", "bar", "dot", "circle", "diamond", "triangle_outline"]) {
      const picture = renderDrawing(sceneOf([
        { id: "a", type: "arrow", x: 0, y: 0, width: 80, height: 0, strokeWidth: 4, points: [[0, 0], [80, 0]], endArrowhead: kind },
      ]));
      for (const [x, y] of headPoints(picture.markup)) covers(picture.bounds, x, y);
    }
    const bar = renderDrawing(sceneOf([
      { id: "a", type: "arrow", x: 0, y: 0, width: 100, height: 0, strokeWidth: 20, points: [[0, 0], [100, 0]], endArrowhead: "bar" },
    ]));
    expect(bar.bounds.y).toBeCloseTo(-(66 * 0.45) - 10, 5);
    expect(bar.bounds.height).toBeCloseTo(66 * 0.45 * 2 + 20, 5);
  });

  it("keeps a rotated bar inside the scene after it swings out of the stored box", () => {
    const picture = renderDrawing(sceneOf([
      { id: "a", type: "arrow", x: 0, y: 0, width: 100, height: 0, angle: Math.PI / 2, strokeWidth: 20, points: [[0, 0], [100, 0]], endArrowhead: "bar" },
    ]));
    expect(picture.markup).toContain("rotate(90 50 0)");
    expect(picture.bounds.x).toBeCloseTo(10.3, 4);
    expect(picture.bounds.y).toBeCloseTo(-60, 4);
    expect(picture.bounds.width).toBeCloseTo(79.4, 4);
    expect(picture.bounds.height).toBeCloseTo(120, 4);
    covers(picture.viewBox, picture.bounds.x, picture.bounds.y);
  });

  it("fits a scene made only of negative and rotated strokes", () => {
    const parts = [line, arrow, freedraw].map((el) => renderDrawing(sceneOf([el])).bounds);
    const picture = renderDrawing(sceneOf([line, arrow, freedraw]));
    expect(picture.markup.match(/data-id="/g)).toHaveLength(3);
    expect(picture.bounds.x).toBeCloseTo(Math.min(...parts.map((b) => b.x)), 8);
    expect(picture.bounds.y).toBeCloseTo(Math.min(...parts.map((b) => b.y)), 8);
    expect(picture.bounds.x + picture.bounds.width).toBeCloseTo(Math.max(...parts.map((b) => b.x + b.width)), 8);
    expect(picture.bounds.y + picture.bounds.height).toBeCloseTo(Math.max(...parts.map((b) => b.y + b.height)), 8);
    expect(picture.viewBox).toEqual({
      x: picture.bounds.x - 16,
      y: picture.bounds.y - 16,
      width: picture.bounds.width + 32,
      height: picture.bounds.height + 32,
    });
    const gone = renderDrawing(sceneOf([line, { ...freedraw, id: "gone", isDeleted: true, x: -5000, y: -5000 }]));
    expect(gone.viewBox).toEqual(renderDrawing(sceneOf([line])).viewBox);
  });
});


describe("rendered point geometry containment", () => {
  it("fits sampled emitted curves at oblique angles with heads at both ends", () => {
    // Sample the emitted SVG, independently of the renderer's extrema helpers.
    // Oblique angles exercise both axes; the older regressions use quarter turns.
    for (const type of ["line", "arrow", "freedraw"]) {
      for (const angle of [-2.3, -0.37, 0.61, 2.8]) {
        for (const head of ["arrow", "triangle_outline", "diamond_outline", "circle_outline", "dot", "bar"]) {
          const picture = renderDrawing(sceneOf([{
            id: "sample", type, x: 137, y: -83, width: 2, height: 3,
            points: [[0, 0], [-120, 70], [-35, -90], [40, -10]],
            angle, strokeWidth: 8, roundness: { type: 2 },
            startArrowhead: head, endArrowhead: head,
          }]));
          const rotation = picture.markup.match(/rotate\(([-\d.]+) ([-\d.]+) ([-\d.]+)\)/)!;
          const radians = Number(rotation[1]) * Math.PI / 180;
          const cx = Number(rotation[2]), cy = Number(rotation[3]);
          const check = (x: number, y: number) => {
            const rx = cx + (x - cx) * Math.cos(radians) - (y - cy) * Math.sin(radians);
            const ry = cy + (x - cx) * Math.sin(radians) + (y - cy) * Math.cos(radians);
            // Include the stroke, not just the centreline, within the fitted view.
            covers(picture.viewBox, rx - 4, ry - 4);
            covers(picture.viewBox, rx + 4, ry + 4);
          };
          for (const path of picture.markup.matchAll(/<path[^>]* d="([^"]+)"/g)) {
            let previous = [0, 0];
            for (const command of path[1].matchAll(/([MLC])([^MLCZ]+)/g)) {
              const values = command[2].trim().split(/\s+/).map(Number);
              if (command[1] === "C") {
                for (let step = 0; step <= 100; step++) {
                  const t = step / 100, u = 1 - t;
                  check(...[0, 1].map(axis => u ** 3 * previous[axis]
                    + 3 * u ** 2 * t * values[axis]
                    + 3 * u * t ** 2 * values[axis + 2]
                    + t ** 3 * values[axis + 4]) as [number, number]);
                }
                previous = values.slice(4);
              } else {
                previous = values;
                check(values[0], values[1]);
              }
            }
          }
          // Circular and bar heads are separate SVG elements.
          for (const circle of picture.markup.matchAll(/<circle[^>]* cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)) {
            for (let step = 0; step < 32; step++) {
              const a = step * Math.PI / 16;
              check(Number(circle[1]) + Number(circle[3]) * Math.cos(a), Number(circle[2]) + Number(circle[3]) * Math.sin(a));
            }
          }
          for (const bar of picture.markup.matchAll(/<line[^>]* x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/g)) {
            check(Number(bar[1]), Number(bar[2]));
            check(Number(bar[3]), Number(bar[4]));
          }
        }
      }
    }
  });

  it("fits a single negative-offset freedraw dot with its full stroke", () => {
    const picture = renderDrawing(sceneOf([{
      id: "dot", type: "freedraw", x: 300, y: 200, width: 500, height: 500,
      points: [[-200, -100]], strokeWidth: 8, angle: 0.61,
    }]));
    expect(picture.markup).toContain('cx="100" cy="100" r="8"');
    expect(picture.markup).toContain('rotate(34.95 100 100)');
    covers(picture.bounds, 88, 100);
    covers(picture.bounds, 112, 100);
    covers(picture.bounds, 100, 88);
    covers(picture.bounds, 100, 112);
  });
});
