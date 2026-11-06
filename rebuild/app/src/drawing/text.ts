// Text layout for the editor: a free text box sized to its lines, a label
// wrapped to fit inside its shape (`containerId`), and a label on an arrow.
// Widths come from a `Measure` the caller passes in; the editor measures with
// a canvas in the same font the renderer draws with.

import { centreOf, elementFrame, rotatePoint, type Frame } from "./geometry";
import type { Patch } from "./linear";
import type { DrawingElement, Point, TextAlign, VerticalAlign } from "./scene";

/** The width of one line of text. */
export type Measure = (line: string, fontSize: number, fontFamily: number) => number;

export interface TextStyle { fontSize: number; fontFamily: number; lineHeight: number; textAlign: TextAlign; verticalAlign: VerticalAlign }

/** Space between a label and its shape's edge, as Excalidraw leaves it. */
export const LABEL_PAD = 5;

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const lineHeightOf = (s: TextStyle) => s.fontSize * (s.lineHeight > 0 ? s.lineHeight : 1.25);

/** The box a text takes: its widest line, and one line height per line. */
export function textSize(text: string, style: TextStyle, measure: Measure): { width: number; height: number } {
  const lines = text.split("\n");
  let width = 0;
  for (const line of lines) width = Math.max(width, measure(line, style.fontSize, style.fontFamily));
  return { width: r4(width), height: r4(lines.length * lineHeightOf(style)) };
}

/**
 * `text` broken into lines no wider than `max`. Lines break at spaces; a word
 * longer than a line breaks between letters. Line breaks already there stay.
 */
export function wrapText(text: string, max: number, style: TextStyle, measure: Measure): string {
  const width = (s: string) => measure(s, style.fontSize, style.fontFamily);
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (width(para) <= max) { out.push(para); continue; }
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      const next = line + word;
      if (width(next) <= max) { line = next; continue; }
      if (/^\s+$/.test(word)) { out.push(line.replace(/\s+$/, "")); line = ""; continue; }
      if (line.trim()) out.push(line.replace(/\s+$/, ""));
      line = "";
      // A word wider than the line on its own goes letter by letter.
      let piece = "";
      for (const ch of word) {
        if (piece && width(piece + ch) > max) { out.push(piece); piece = ""; }
        piece += ch;
      }
      line = piece;
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out.join("\n");
}

/** A free text element holding `value`. Its left, centre or right edge stays put, as its alignment says. */
export function freeTextPatch(el: DrawingElement, value: string, style: TextStyle, measure: Measure): Patch {
  const { width, height } = textSize(value, style, measure);
  const oldW = Math.abs(el.width);
  const x = style.textAlign === "center" ? el.x + oldW / 2 - width / 2 : style.textAlign === "right" ? el.x + oldW - width : el.x;
  return { x: r4(x), width, height, text: value, originalText: value };
}

// How much of a shape's box its inside spans, across and down.
const INNER: Record<string, number> = { rectangle: 1, image: 1, ellipse: Math.SQRT1_2, diamond: 0.5 };

/** The widest a label's lines may be inside a shape of this type and width. */
export function labelWidthFor(type: string, width: number, fontSize: number): number {
  return Math.max(fontSize, Math.abs(width) * (INNER[type] ?? 1) - LABEL_PAD * 2);
}

/**
 * A label holding `value` laid out in shape `container`: wrapped to its
 * inside, placed by the label's alignment, turned with the shape. A shape too
 * short for the text grows downward (in its own axes) to fit it.
 */
export function labelPatch(container: DrawingElement, value: string, style: TextStyle, measure: Measure): { label: Patch; container: Patch | null } {
  const f = elementFrame(container);
  const k = INNER[container.type] ?? 1;
  const text = wrapText(value, labelWidthFor(container.type, f.width, style.fontSize), style, measure);
  const { width, height } = textSize(text, style, measure);
  let frame: Frame = f;
  let grown: Patch | null = null;
  const need = (height + LABEL_PAD * 2) / k;
  if (need > f.height + 1e-6) {
    // Keep the top edge where it is on screen: the centre moves down the shape's own axis.
    const c = centreOf(f);
    const nc = rotatePoint([c[0], c[1] + (need - f.height) / 2], c, f.angle);
    frame = { x: nc[0] - f.width / 2, y: nc[1] - need / 2, width: f.width, height: need, angle: f.angle };
    grown = { x: r4(frame.x), y: r4(frame.y), height: r4(need) };
  }
  const c = centreOf(frame);
  const insetX = (frame.width - frame.width * k) / 2 + LABEL_PAD;
  const insetY = (frame.height - frame.height * k) / 2 + LABEL_PAD;
  const left = style.textAlign === "left" ? frame.x + insetX : style.textAlign === "right" ? frame.x + frame.width - insetX - width : c[0] - width / 2;
  const top = style.verticalAlign === "top" ? frame.y + insetY : style.verticalAlign === "bottom" ? frame.y + frame.height - insetY - height : c[1] - height / 2;
  const mid = rotatePoint([left + width / 2, top + height / 2], c, frame.angle);
  return {
    label: { x: r4(mid[0] - width / 2), y: r4(mid[1] - height / 2), width, height, angle: frame.angle, text, originalText: value },
    container: grown,
  };
}

/** A label holding `value` on an arrow, centred on the point `at`. */
export function arrowTextPatch(at: Point, value: string, style: TextStyle, measure: Measure): Patch {
  const { width, height } = textSize(value, style, measure);
  return { x: r4(at[0] - width / 2), y: r4(at[1] - height / 2), width, height, angle: 0, text: value, originalText: value };
}

/** A rough width for when no canvas is to hand: monospace-ish, a bit over half the size per letter. */
export const roughMeasure: Measure = (line, size, family) => [...line].length * size * (family === 3 ? 0.6 : 0.55);
