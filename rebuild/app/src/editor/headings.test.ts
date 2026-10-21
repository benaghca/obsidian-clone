import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { headingPos } from "./headings";

test("heading lookup is case-insensitive and skips the marker", () => {
  const doc = EditorState.create({ doc: "intro\n## Section 2\nbody\n# Title #\n" }).doc;
  expect(headingPos(doc, "section 2")).toBe(doc.line(2).from);
  expect(headingPos(doc, "Title")).toBe(doc.line(4).from);
  expect(headingPos(doc, "missing")).toBeNull();
  expect(headingPos(doc, "  ")).toBeNull();
});

test("nested heading paths use the last segment; #^id finds the block's line", () => {
  const doc = EditorState.create({ doc: "# Top\ntext ^abc\n### Deep one\n- item ^Item-2 \n" }).doc;
  expect(headingPos(doc, "Top#Deep one")).toBe(doc.line(3).from);
  expect(headingPos(doc, "^abc")).toBe(doc.line(2).from);
  expect(headingPos(doc, "Top#^item-2")).toBe(doc.line(4).from);
  expect(headingPos(doc, "^nope")).toBeNull();
  expect(headingPos(doc, "^")).toBeNull();
});
