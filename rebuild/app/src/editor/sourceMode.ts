// Source mode, as Obsidian draws it: the raw markdown, in the normal text
// font, with its syntax highlighted (faint marks, accent links, bold,
// italic, struck and code text, tags as pills, code blocks on a grey band)
// but headings at the body size. Only active in Source mode: Live Preview
// and Reading view draw their own decorations and never load this.

import { syntaxHighlighting, syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { tags as t, tagHighlighter } from "@lezer/highlight";
import { eachCodeBlock } from "./codeHighlight";
import { hashtag, wikiTarget } from "./syntax";

const highlighter = tagHighlighter([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], class: "cm-s-heading" },
  { tag: t.emphasis, class: "cm-s-em" },
  { tag: t.strong, class: "cm-s-strong" },
  { tag: t.strikethrough, class: "cm-s-strike" },
  { tag: t.monospace, class: "cm-s-code" },
  { tag: [t.link, wikiTarget], class: "cm-s-link" },
  { tag: t.url, class: "cm-s-url" },
  { tag: [t.processingInstruction, t.contentSeparator, t.comment], class: "cm-s-mark" },
  { tag: t.atom, class: "cm-s-task" },
  { tag: hashtag, class: "cm-s-tag" },
]);

const codeLine = Decoration.line({ class: "cm-codeblock" });
const codeBegin = Decoration.line({ class: "cm-codeblock cm-codeblock-begin" });
const codeEnd = Decoration.line({ class: "cm-codeblock cm-codeblock-end" });
const listLine = Decoration.line({ class: "cm-list-line" });

/** The same code bands and list spacing as Live Preview (visible lines only). */
export function sourceLines(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const doc = view.state.doc;
  eachCodeBlock(view.state, view.visibleRanges, (node, from, to) => {
    const first = doc.lineAt(node.from).number;
    const last = doc.lineAt(node.to).number;
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) {
      decos.push((n === first ? codeBegin : n === last ? codeEnd : codeLine).range(doc.line(n).from));
    }
  });
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "ListMark") decos.push(listLine.range(doc.lineAt(node.from).from));
      },
    });
  }
  return Decoration.set(decos, true);
}

const codeBlockPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = sourceLines(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = sourceLines(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

export const sourceMode = [syntaxHighlighting(highlighter), codeBlockPlugin];
