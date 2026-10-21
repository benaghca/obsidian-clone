// Lezer markdown extensions for Obsidian's own syntax: [[wikilinks]] (with
// optional #heading and |display text), #tags, ==highlights== and
// %%comments%% (inline, or a block from a line that opens with %% to the
// next line holding %%).

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Tag as HighlightTag, styleTags, tags as t } from "@lezer/highlight";
import type { BlockContext, InlineContext, Line, MarkdownConfig } from "@lezer/markdown";
import { codeLanguage } from "./codeHighlight";

/** Highlight tags for Source mode (Live Preview styles these nodes itself). */
export const wikiTarget = HighlightTag.define(t.link);
export const hashtag = HighlightTag.define();

const BRACKET_OPEN = 91; // [
const BRACKET_CLOSE = 93; // ]
const PIPE = 124; // |
const HASH = 35; // #
const BANG = 33; // !
const NEWLINE = 10;
const EQUALS = 61; // =
const PERCENT = 37; // %

export const WikiLink: MarkdownConfig = {
  defineNodes: [
    "WikiLink",
    { name: "WikiLinkMark", style: t.processingInstruction },
    { name: "WikiLinkTarget", style: wikiTarget },
    { name: "WikiLinkAlias", style: wikiTarget },
  ],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      // ![[embed]]: the "!" stays text before the WikiLink (Image would take "![" otherwise).
      parse(cx: InlineContext, next: number, start: number) {
        const pos = next === BANG ? start + 1 : start;
        if (cx.char(pos) !== BRACKET_OPEN || cx.char(pos + 1) !== BRACKET_OPEN) return -1;
        let pipe = -1;
        for (let i = pos + 2; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === NEWLINE || ch === BRACKET_OPEN) return -1;
          if (ch === PIPE && pipe < 0) pipe = i;
          if (ch === BRACKET_CLOSE) {
            if (cx.char(i + 1) !== BRACKET_CLOSE) return -1;
            const targetEnd = pipe < 0 ? i : pipe;
            if (targetEnd === pos + 2) return -1;
            const children = [cx.elt("WikiLinkMark", pos, pos + 2), cx.elt("WikiLinkTarget", pos + 2, targetEnd)];
            if (pipe >= 0) {
              children.push(cx.elt("WikiLinkMark", pipe, pipe + 1));
              if (i > pipe + 1) children.push(cx.elt("WikiLinkAlias", pipe + 1, i));
            }
            children.push(cx.elt("WikiLinkMark", i, i + 2));
            return cx.addElement(cx.elt("WikiLink", pos, i + 2, children));
          }
        }
        return -1;
      },
    },
  ],
};

const isTagChar = (ch: number) =>
  ch === 95 || ch === 45 || ch === 47 || /[\p{L}\p{N}]/u.test(String.fromCharCode(ch));
const isSpace = (ch: number) => ch === 32 || ch === 9 || ch === NEWLINE;

export const Tag: MarkdownConfig = {
  defineNodes: [{ name: "Tag", style: { "Tag/...": hashtag } }, "TagMark"],
  parseInline: [
    {
      name: "Tag",
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== HASH) return -1;
        if (pos > cx.offset && !isSpace(cx.char(pos - 1))) return -1;
        let end = pos + 1;
        let hasNonDigit = false;
        while (end < cx.end && isTagChar(cx.char(end))) {
          if (!/\d/.test(String.fromCharCode(cx.char(end)))) hasNonDigit = true;
          end++;
        }
        if (end === pos + 1 || !hasNonDigit) return -1;
        return cx.addElement(cx.elt("Tag", pos, end, [cx.elt("TagMark", pos, pos + 1)]));
      },
    },
  ],
};

/**
 * Source mode draws markers in their text's style, as Obsidian does: the
 * ~~ of struck text is struck, the backticks of inline code are code.
 */
export const MarkerStyles: MarkdownConfig = {
  props: [styleTags({ "Strikethrough/...": t.strikethrough, "InlineCode/...": t.monospace })],
};

const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };

/** ==highlight==, delimited like GFM's ~~strikethrough~~. */
export const Highlight: MarkdownConfig = {
  defineNodes: [{ name: "Highlight", style: { "Highlight/...": t.special(t.content) } }, { name: "HighlightMark", style: t.processingInstruction }],
  parseInline: [
    {
      name: "Highlight",
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, !/\s|^$/.test(after), !/\s|^$/.test(before));
      },
      after: "Emphasis",
    },
  ],
};

/** %%comment%%: nothing inside is markdown. A line opening one that doesn't close it starts a CommentBlock. */
export const Comment: MarkdownConfig = {
  defineNodes: [
    { name: "Comment", style: t.comment },
    { name: "CommentMark", style: t.comment },
    { name: "CommentBlock", block: true, style: t.comment },
  ],
  parseInline: [
    {
      name: "Comment",
      before: "Emphasis",
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== PERCENT || cx.char(pos + 1) !== PERCENT) return -1;
        for (let i = pos + 2; i < cx.end - 1; i++) {
          if (cx.char(i) === PERCENT && cx.char(i + 1) === PERCENT) {
            return cx.addElement(cx.elt("Comment", pos, i + 2, [cx.elt("CommentMark", pos, pos + 2), cx.elt("CommentMark", i, i + 2)]));
          }
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      name: "CommentBlock",
      before: "FencedCode",
      parse(cx: BlockContext, line: Line) {
        if (!line.text.startsWith("%%", line.pos) || line.text.includes("%%", line.pos + 2)) return false;
        const from = cx.lineStart + line.pos;
        let to = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          to = cx.lineStart + line.text.length;
          if (line.text.includes("%%")) {
            cx.nextLine();
            break;
          }
        }
        cx.addElement(cx.elt("CommentBlock", from, to));
        return true;
      },
    },
  ],
};

/** Markdown with every extension above: the notes' language, in the editor and in rendered embeds. */
export const markdownSyntax = markdown({
  base: markdownLanguage,
  extensions: [WikiLink, Tag, Highlight, Comment, MarkerStyles],
  codeLanguages: codeLanguage,
  addKeymap: false,
});
