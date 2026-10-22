// What the pointer meets in the editor: the fold chevron's hover area.
import { expect, test } from "vitest";
import editorCss from "./editor.css?raw";

/** The declarations of the rule with exactly this selector. */
const rule = (css: string, selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
const px = (block: string, prop: string) => Number(new RegExp(`(?:^|\\s)${prop}:\\s*(-?[\\d.]+)(?:px)?;`).exec(block)?.[1]);

test("the hover chevron sits inside the editor's own margin, so reaching for it never leaves the editor", () => {
  const editor = rule(editorCss, ".cm-editor");
  const chevron = rule(editorCss, ".cm-fold-indicator");
  // The editor reaches into the margin without moving the text...
  expect(px(editor, "margin-left")).toBe(-px(editor, "padding-left"));
  // ...far enough to hold the whole chevron, right up to the text.
  expect(px(chevron, "left")).toBeGreaterThanOrEqual(0);
  expect(px(chevron, "left") + px(chevron, "width")).toBeLessThanOrEqual(px(editor, "padding-left"));
});
