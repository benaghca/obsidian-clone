import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { headingLabel, headingPos, headingTarget } from "./headings";

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

test("block ids skip code fences and blank lines, and a first-line id resolves", () => {
  const fenced = EditorState.create({ doc: "```\ncode ^abc\n```\npara ^abc\n" }).doc;
  expect(headingPos(fenced, "^abc")).toBe(fenced.line(4).from);
  expect(headingPos(EditorState.create({ doc: "```\nonly ^abc\n```\n" }).doc, "^abc")).toBeNull();
  expect(headingPos(EditorState.create({ doc: "^abc\n\npara\n" }).doc, "^abc")).toBe(0);
  expect(headingPos(EditorState.create({ doc: "para\n\n\n^abc\n" }).doc, "^abc")).toBe(0);
  expect(headingPos(EditorState.create({ doc: "\n^abc\n" }).doc, "^abc")).toBeNull();
  const tilde = EditorState.create({ doc: "~~~\n^abc\n```\npara ^abc\n~~~\nout ^abc\n" }).doc;
  expect(headingPos(tilde, "^abc")).toBe(tilde.line(6).from);
  const two = "```\none\n```\n```\ntwo\n```\n\n^abc\n";
  expect(headingPos(EditorState.create({ doc: two }).doc, "^abc")).toBe(two.lastIndexOf("```\ntwo"));
});

test("heading targets omit block IDs and normalize pipes like Obsidian", () => {
  const doc = EditorState.create({ doc: "Intro.\n\n# Has id ^keep\n\n# Pipe | split\n" }).doc;
  expect(headingLabel(doc.line(3).text)).toBe("Has id");
  expect(headingPos(doc, "Has id")).toBe(doc.line(3).from);
  expect(headingTarget("Pipe | split")).toBe("Pipe split");
  expect(headingPos(doc, "Pipe split")).toBe(doc.line(5).from);
  expect(headingPos(doc, "Pipe | split")).toBe(doc.line(5).from);
});
