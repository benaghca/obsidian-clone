// A drawing as a picture file: a standalone SVG, or PNG bytes drawn from it.
// The picture is the drawing in its own colours (light), with its paper,
// drawn by the same renderer as the tab and embeds. Images inside the drawing
// go in as their data URLs, so the SVG stands on its own.

import { renderDrawing } from "./render";
import type { Scene } from "./scene";

export type PictureKind = "svg" | "png";

/** PNG pixels per drawing unit, and the longest side a PNG may have. */
const PNG_SCALE = 2;
const PNG_MAX_SIDE = 8192;

/** "Folder/Sketch.excalidraw" → "Folder/Sketch.svg". */
export const picturePath = (path: string, kind: PictureKind) => `${path.replace(/\.excalidraw$/i, "")}.${kind}`;

/** The drawing as a standalone SVG document. */
export function drawingSvg(scene: Scene): string {
  const picture = renderDrawing(scene, { images: (id) => scene.files.get(id)?.dataURL, idPrefix: "export", paper: true });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${picture.markup}\n`;
}

/** The size in pixels of a PNG of `width` by `height` units: twice that, unless a side would pass the limit. */
export function pngSize(width: number, height: number): { width: number; height: number; scale: number } {
  const scale = Math.min(PNG_SCALE, PNG_MAX_SIDE / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/** The drawing as PNG bytes, drawn from its SVG. */
export async function drawingPng(scene: Scene): Promise<Uint8Array> {
  const { viewBox } = renderDrawing(scene, { idPrefix: "measure", paper: false, omitMarkup: true });
  const size = pngSize(viewBox.width, viewBox.height);
  const picture = renderDrawing(scene, { images: (id) => scene.files.get(id)?.dataURL, idPrefix: "export", paper: true, width: size.width, height: size.height });
  const url = URL.createObjectURL(new Blob([picture.markup], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas to draw on");
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("the picture couldn’t be made");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
