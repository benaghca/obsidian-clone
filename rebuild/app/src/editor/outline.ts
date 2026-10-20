// A note's headings, read from its markdown syntax tree. Headings are
// top-level blocks, so only the root's children are visited: a few thousand
// nodes for a 5,000-line note, well under a millisecond once it is parsed.

import type { Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

export interface Heading {
  level: number;
  /** Visible text, markdown stripped. */
  text: string;
  /** Start of the heading line. */
  from: number;
}

export function headingsFromTree(tree: Tree, doc: Text): Heading[] {
  const out: Heading[] = [];
  const cursor = tree.cursor();
  if (!cursor.firstChild()) return out;
  do {
    const name = cursor.name;
    if (name.startsWith("ATXHeading") || name.startsWith("SetextHeading")) {
      const node = cursor.node;
      out.push({ level: Number(name.slice(-1)), text: headingText(doc, node), from: node.from });
    }
  } while (cursor.nextSibling());
  return out;
}

function headingText(doc: Text, node: SyntaxNode): string {
  let raw: string;
  if (node.name.startsWith("ATXHeading")) {
    raw = doc.sliceString(node.from, node.to).replace(/^#{1,6}[ \t]*/, "").replace(/[ \t]+#+[ \t]*$/, "");
  } else {
    const underline = node.getChild("HeaderMark");
    raw = doc.sliceString(node.from, underline ? underline.from : node.to);
  }
  return plainText(raw);
}

/** Markdown inline syntax reduced to the text a reader sees. */
export function plainText(md: string): string {
  return md
    .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2") // [[target|alias]]
    .replace(/!?\[\[([^\]]*)\]\]/g, (_, t: string) => t.replace(/#/g, " > ").trim()) // [[target#heading]]
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url)
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])([*_])(\S(?:.*?\S)?)\2(?![\w*])/g, "$1$3")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Each heading's depth in the tree, like Obsidian's outline: a heading
 * nests under the nearest earlier heading with a smaller level, so an H3
 * straight under an H1 is one step in, not two.
 */
export function outlineDepths(headings: Heading[]): number[] {
  const stack: number[] = [];
  return headings.map((h) => {
    while (stack.length && stack[stack.length - 1] >= h.level) stack.pop();
    stack.push(h.level);
    return stack.length - 1;
  });
}
