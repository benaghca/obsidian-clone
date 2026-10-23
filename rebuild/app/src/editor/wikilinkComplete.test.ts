import { Text } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { expect, test } from "vitest";
import { linkBlocks } from "./wikilinkComplete";
import { embedSection } from "./embeds";
import { headingPos } from "./headings";
import { formatLink } from "../links/internal";

const document = (text: string) => Text.of(text.split("\n"));
test("block choices keep paragraphs, individual list items, quotes and fenced code in document order", () => {
  const text = '# Heading\n\nParagraph **one**\nsecond line.\n\nExisting. ^known\n\n- Item one\n- Item two\n\n> Quote\n> body\n\n^quote\n\n```js\ncode\n\nmore code\n```\n\n^code';
  const blocks = linkBlocks(markdownLanguage.parser.parse(text), document(text));
  expect(blocks.map(b => b.label)).toEqual(['# Heading', 'Paragraph one\nsecond line.', 'Existing.', 'Item one', 'Item two', 'Quote\nbody', 'code\n\nmore code']);
  expect(blocks.map(b => b.id)).toEqual([undefined, undefined, 'known', undefined, undefined, 'quote', 'code']);
  expect(blocks.slice(-2).every(b => b.separate)).toBe(true);
  expect(blocks.every(b => text.slice(b.from, b.to).length > 0)).toBe(true);
});
test("frontmatter is excluded from block choices", () => {
  const text = '---\ntags: [test]\n---\n\n# Heading\n\nBody';
  expect(linkBlocks(markdownLanguage.parser.parse(text), document(text), 19).map(b => b.label)).toEqual(['# Heading', 'Body']);
});
test("standalone IDs navigate to and embed the whole quoted/code block, including blank code lines", () => {
  for (const block of ['> Quote\n> body', '```js\ncode\n\nmore code\n```']) {
    const text = `Intro.\n\n${block}\n\n^target\n\nAfter.`;
    expect(headingPos(document(text), '^target')).toBe(text.indexOf(block));
    expect(embedSection(text, '^target')?.text).toBe(block);
  }
});
test("same-note heading links honor relative and Markdown link settings without a file path", () => {
  const style = { format: 'relative', wikilinks: true } as const;
  expect(formatLink('', 'Folder/Current.md', [], style, undefined, '#Heading')).toBe('[[#Heading]]');
  expect(formatLink('', 'Folder/Current.md', [], {...style,wikilinks:false}, undefined, '#Heading One')).toBe('[Heading One](#Heading%20One)');
});

test("an orphan standalone ID cannot crash navigation or embedding", () => {
  expect(headingPos(document("^target"), "^target")).toBe(0);
  expect(embedSection("^target", "^target")).toBeNull();
});

test("nested list rows own their text, ID and insertion position at every depth", () => {
  const text = '- Parent item ^parent\n\n  - Nested item\n    1. Deep item ^deep\n- Sibling item';
  const blocks = linkBlocks(markdownLanguage.parser.parse(text), document(text));
  expect(blocks.map(b => b.label)).toEqual(['Parent item', 'Nested item', 'Deep item', 'Sibling item']);
  expect(blocks.map(b => b.id)).toEqual(['parent', undefined, 'deep', undefined]);
  expect(blocks.map(b => text.slice(b.from, b.to))).toEqual(['- Parent item ^parent', '- Nested item', '1. Deep item ^deep', '- Sibling item']);
});

test("heading embeds use the same block-ID and pipe normalization as navigation", () => {
  const text = '# Has id ^keep\n\nFirst.\n\n# Pipe | split\n\nSecond.';
  expect(embedSection(text, 'Has id')?.text).toBe('# Has id ^keep\n\nFirst.');
  expect(embedSection(text, 'Pipe split')?.text).toBe('# Pipe | split\n\nSecond.');
});
