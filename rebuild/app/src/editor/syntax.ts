// Lezer markdown extensions for the two Obsidian-only inline elements:
// [[wikilinks]] (with optional #heading and |display text) and #tags.

import type { InlineContext, MarkdownConfig } from "@lezer/markdown";

const BRACKET_OPEN = 91; // [
const BRACKET_CLOSE = 93; // ]
const PIPE = 124; // |
const HASH = 35; // #
const NEWLINE = 10;

export const WikiLink: MarkdownConfig = {
  defineNodes: ["WikiLink", "WikiLinkMark", "WikiLinkTarget", "WikiLinkAlias"],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== BRACKET_OPEN || cx.char(pos + 1) !== BRACKET_OPEN) return -1;
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
  defineNodes: ["Tag", "TagMark"],
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
