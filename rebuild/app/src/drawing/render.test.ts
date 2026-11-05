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
