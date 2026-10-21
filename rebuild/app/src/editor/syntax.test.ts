import { markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownParser } from "@lezer/markdown";
import { expect, test } from "vitest";
import { Comment, Highlight, Tag, WikiLink } from "./syntax";

const parser = (markdownLanguage.parser as MarkdownParser).configure([WikiLink, Tag, Highlight, Comment]);

function nodes(doc: string): string[] {
  const out: string[] = [];
  parser.parse(doc).iterate({
    enter: (n) => {
      if (/^(WikiLink|Tag|Highlight|Comment)/.test(n.name)) out.push(`${n.name}:${doc.slice(n.from, n.to)}`);
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

test("==highlight== is delimited like strikethrough", () => {
  expect(nodes("a ==marked **bold**== b")).toEqual(["Highlight:==marked **bold**==", "HighlightMark:==", "HighlightMark:=="]);
  expect(nodes("a == b == c")).toEqual([]);
});

test("%%comments%% inline, and as a block across lines", () => {
  expect(nodes("a %%no **md** here%% b")).toEqual(["Comment:%%no **md** here%%", "CommentMark:%%", "CommentMark:%%"]);
  expect(nodes("x\n\n%%\nhidden\n\nstill %%\nafter")).toEqual(["CommentBlock:%%\nhidden\n\nstill %%"]);
  expect(nodes("%% unclosed\nto the end")).toEqual(["CommentBlock:%% unclosed\nto the end"]);
});

test("![[embeds]] are wikilinks after a plain \"!\"", () => {
  expect(nodes("![[pic.png|200]]")).toEqual(["WikiLink:[[pic.png|200]]", "WikiLinkMark:[[", "WikiLinkTarget:pic.png", "WikiLinkMark:|", "WikiLinkAlias:200", "WikiLinkMark:]]"]);
});
