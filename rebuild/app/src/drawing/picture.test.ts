import { describe, expect, it } from "vitest";
import { drawingSvg, picturePath, pngSize } from "./picture";
import { parseScene, type Scene } from "./scene";

function sceneOf(elements: unknown[], files: Record<string, unknown> = {}): Scene {
  const parsed = parseScene(JSON.stringify({ type: "excalidraw", version: 2, elements, appState: { viewBackgroundColor: "#fafafa" }, files }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.scene;
}

describe("drawing export", () => {
  it("names the picture after the drawing, beside it", () => {
    expect(picturePath("Sketch.excalidraw", "svg")).toBe("Sketch.svg");
    expect(picturePath("Plans/Floor 2.EXCALIDRAW", "png")).toBe("Plans/Floor 2.png");
  });

  it("makes a PNG twice the drawing's size, shrinking only past the longest side allowed", () => {
    expect(pngSize(320, 180)).toEqual({ width: 640, height: 360, scale: 2 });
    const big = pngSize(16384, 4096);
    expect(big.width).toBe(8192);
    expect(big.height).toBe(2048);
    expect(pngSize(0, 0)).toEqual({ width: 1, height: 1, scale: 2 });
  });

  it("writes a standalone SVG with the paper colour and images inline", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const scene = sceneOf([
      { id: "box", type: "rectangle", x: 10, y: 20, width: 100, height: 50, strokeColor: "#1e1e1e" },
      { id: "pic", type: "image", x: 200, y: 20, width: 40, height: 40, fileId: "f1", status: "saved" },
    ], { f1: { id: "f1", mimeType: "image/png", dataURL: png } });
    const svg = drawingSvg(scene);
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('fill="#fafafa"');
    expect(svg).toContain(`href="${png}"`);
    expect(svg).not.toContain("blob:");
    expect(svg).toContain('data-id="box"');
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });
});
