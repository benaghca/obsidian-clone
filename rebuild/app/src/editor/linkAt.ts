// What link, if any, is at a document position: for the editor's context
// menu ("Open in new tab", "Edit link", "Copy URL") and the link commands.

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { isNotePath } from "../links/external";

/** An internal link's target, with where that target text sits (for "Edit link"). */
type LinkAt = { kind: "internal"; target: string; from: number; to: number } | { kind: "external"; url: string };

/** Backslash escapes in a Markdown destination are syntax, not part of the URL. */
export const markdownURL = (text: string) => text.replace(/\\([\\()])/g, "$1");

export function linkAt(state: EditorState, pos: number): LinkAt | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === "WikiLink") {
        const target = node.getChild("WikiLinkTarget");
        if (target) return { kind: "internal", target: state.sliceDoc(target.from, target.to).trim(), from: target.from, to: target.to };
      }
      if (node.name === "Link" || node.name === "Image") {
        const url = node.getChild("URL");
        if (!url) continue;
        const href = markdownURL(state.sliceDoc(url.from, url.to));
        // A [markdown](link) to a note is an internal link.
        return isNotePath(href) || href.startsWith("#") ? { kind: "internal", target: href, from: url.from, to: url.to } : { kind: "external", url: href };
      }
      if (node.name === "URL" && node.parent?.name !== "Link" && node.parent?.name !== "Image") return { kind: "external", url: state.sliceDoc(node.from, node.to) };
    }
  }
  return null;
}
