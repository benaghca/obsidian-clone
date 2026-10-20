import { markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { MarkdownParser } from "@lezer/markdown";
import { expect, test } from "vitest";
import { headingAt, headingsFromTree, outlineDepths, plainText } from "./outline";
import { Tag, WikiLink } from "./syntax";

const parser = (markdownLanguage.parser as MarkdownParser).configure([WikiLink, Tag]);

function headings(text: string) {
  const doc = EditorState.create({ doc: text }).doc;
  return headingsFromTree(parser.parse(text), doc);
}

test("ATX and setext headings in order, with levels and line starts", () => {
  const text = "# Title\nintro\n## Part *one* ##\n\nSetext two\n---\n### Deep\n";
  expect(headings(text)).toEqual([
    { level: 1, text: "Title", from: text.indexOf("# Title") },
    { level: 2, text: "Part one", from: text.indexOf("## Part") },
    { level: 2, text: "Setext two", from: text.indexOf("Setext") },
    { level: 3, text: "Deep", from: text.indexOf("### Deep") },
  ]);
});

test("headings in code blocks, quotes and lists are not in the outline", () => {
  const text = "```\n# not a heading\n```\n> # quoted\n- # in a list\n# Real\n";
  expect(headings(text).map((h) => h.text)).toEqual(["Real"]);
});

test("heading text drops markdown syntax", () => {
  expect(plainText("**Bold** and `code` with [[Note|alias]], [[Other#Part]] and [a link](https://x.y)")).toBe(
    "Bold and code with alias, Other > Part and a link",
  );
  expect(plainText("snake_case_name and *em*")).toBe("snake_case_name and em");
});

test("depths nest under the nearest smaller level", () => {
  const hs = [1, 3, 2, 3, 1, 2].map((level, i) => ({ level, text: String(i), from: i }));
  expect(outlineDepths(hs)).toEqual([0, 1, 1, 2, 0, 1]);
  expect(outlineDepths([{ level: 2, text: "", from: 0 }, { level: 1, text: "", from: 1 }])).toEqual([0, 0]);
});

test("the heading at a position is the last one at or before it", () => {
  const hs = [10, 50, 90].map((from) => ({ level: 1, text: "", from }));
  expect([0, 10, 49, 50, 1000].map((p) => headingAt(hs, p))).toEqual([-1, 0, 0, 1, 2]);
});
