import { markdownLanguage } from "@codemirror/lang-markdown";
import { expect, test } from "vitest";
import { Tag, WikiLink } from "./syntax";

const parser = markdownLanguage.parser.configure([WikiLink, Tag]);

function nodes(doc: string): string[] {
  const out: string[] = [];
  parser.parse(doc).iterate({
    enter: (n) => {
      if (/^(WikiLink|Tag)/.test(n.name)) out.push(`${n.name}:${doc.slice(n.from, n.to)}`);
    },
  });
  return out;
}

test("wikilink with display text", () => {
  expect(nodes("see [[Some note|shown]] here")).toEqual([
    "WikiLink:[[Some note|shown]]",
    "WikiLinkMark:[[",
    "WikiLinkTarget:Some note",
    "WikiLinkMark:|",
    "WikiLinkAlias:shown",
    "WikiLinkMark:]]",
  ]);
});

test("unclosed or empty wikilinks are plain text", () => {
  expect(nodes("[[open")).toEqual([]);
  expect(nodes("[[]]")).toEqual([]);
});

test("tags need a non-digit and a space or line start before them", () => {
  expect(nodes("#tag and #ideas/later, a#b, #123")).toEqual([
    "Tag:#tag",
    "TagMark:#",
    "Tag:#ideas/later",
    "TagMark:#",
  ]);
});

test("a heading is not a tag", () => {
  expect(nodes("# Heading")).toEqual([]);
});
