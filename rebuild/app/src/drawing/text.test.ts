import { describe, expect, it } from "vitest";
import { centreOf, elementFrame } from "./geometry";
import { parseScene, type DrawingElement } from "./scene";
import { arrowTextPatch, freeTextPatch, LABEL_PAD, labelPatch, labelWidthFor, textSize, wrapText, type Measure, type TextStyle } from "./text";

// Every letter is half the font size wide, so widths are easy to check.
const measure: Measure = (line, size) => line.length * size / 2;
const style = (over: Partial<TextStyle> = {}): TextStyle => ({ fontSize: 20, fontFamily: 2, lineHeight: 1.25, textAlign: "center", verticalAlign: "middle", ...over });
const one = (props: Record<string, unknown>): DrawingElement => {
  const parsed = parseScene(JSON.stringify({ type: "excalidraw", version: 2, elements: [{ id: "a", ...props }] }));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.scene.elements[0];
};

describe("text size and wrapping", () => {
  it("is as wide as the widest line and one line height per line", () => {
    expect(textSize("ab\nabcd", style(), measure)).toEqual({ width: 40, height: 50 });
    expect(textSize("", style(), measure)).toEqual({ width: 0, height: 25 });
  });

  it("breaks at spaces, keeps breaks already there, and splits a word too long for a line", () => {
    expect(wrapText("one two three", 80, style(), measure)).toBe("one two\nthree");
    expect(wrapText("one\ntwo three", 200, style(), measure)).toBe("one\ntwo three");
    expect(wrapText("abcdefghij", 40, style(), measure)).toBe("abcd\nefgh\nij");
    expect(wrapText("ab   cd", 30, style(), measure)).toBe("ab\ncd");
  });
});

describe("free text", () => {
  const el = one({ type: "text", x: 100, y: 50, width: 40, height: 25, text: "ab" });
  it("grows from the edge its alignment holds", () => {
    expect(freeTextPatch(el, "abcd", style({ textAlign: "left" }), measure)).toEqual({ x: 100, width: 40, height: 25, text: "abcd", originalText: "abcd" });
    expect(freeTextPatch(el, "abcdefgh", style({ textAlign: "center" }), measure)).toMatchObject({ x: 80, width: 80 });
    expect(freeTextPatch(el, "abcdefgh", style({ textAlign: "right" }), measure)).toMatchObject({ x: 60, width: 80 });
    expect(freeTextPatch(el, "a\nb", style(), measure)).toMatchObject({ height: 50, text: "a\nb" });
  });
});

describe("labels", () => {
  it("wraps to the inside of each shape type", () => {
    expect(labelWidthFor("rectangle", 200, 20)).toBe(200 - LABEL_PAD * 2);
    expect(labelWidthFor("ellipse", 200, 20)).toBeCloseTo(200 * Math.SQRT1_2 - LABEL_PAD * 2, 9);
    expect(labelWidthFor("diamond", 200, 20)).toBe(100 - LABEL_PAD * 2);
    expect(labelWidthFor("rectangle", 4, 20)).toBe(20);
  });

  it("sits in the middle of its shape and keeps the text typed as `originalText`", () => {
    const box = one({ type: "rectangle", x: 0, y: 0, width: 200, height: 100 });
    const { label, container } = labelPatch(box, "hello world", style(), measure);
    expect(container).toBeNull();
    expect(label).toEqual({ x: 45, y: 37.5, width: 110, height: 25, angle: 0, text: "hello world", originalText: "hello world" });
    const top = labelPatch(box, "hi", style({ verticalAlign: "top", textAlign: "left" }), measure).label;
    expect(top).toMatchObject({ x: LABEL_PAD, y: LABEL_PAD });
  });

  it("grows a shape too short for its text, keeping its top edge", () => {
    const box = one({ type: "rectangle", x: 0, y: 0, width: 60, height: 30 });
    const { label, container } = labelPatch(box, "one two three", style(), measure);
    expect(label.text).toBe("one\ntwo\nthree");
    expect(container).toEqual({ x: 0, y: 0, height: 75 + LABEL_PAD * 2 });
  });

  it("turns with a turned shape and stays on its centre", () => {
    const box = one({ type: "rectangle", x: 0, y: 0, width: 200, height: 100, angle: Math.PI / 3 });
    const { label } = labelPatch(box, "hi", style(), measure);
    const t = one({ type: "text", ...label });
    expect(label.angle).toBeCloseTo(Math.PI / 3, 9);
    const [cx, cy] = centreOf(elementFrame(t)), [bx, by] = centreOf(elementFrame(box));
    expect(cx).toBeCloseTo(bx, 6);
    expect(cy).toBeCloseTo(by, 6);
  });

  it("puts an arrow's label on the point it is given", () => {
    expect(arrowTextPatch([100, 100], "go", style(), measure)).toEqual({ x: 90, y: 87.5, width: 20, height: 25, angle: 0, text: "go", originalText: "go" });
  });
});
