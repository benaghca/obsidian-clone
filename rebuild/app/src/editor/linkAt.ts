// What link, if any, is at a document position: for the editor's context
// menu ("Open link", "Open in new tab", "Copy URL").

import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type LinkAt = { kind: "internal"; target: string } | { kind: "external"; url: string };

export function linkAt(state: EditorState, pos: number): LinkAt | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === "WikiLink") {
        const target = node.getChild("WikiLinkTarget");
        if (target) return { kind: "internal", target: state.sliceDoc(target.from, target.to).trim() };
      }
      if (node.name === "Link" || node.name === "Image") {
        const url = node.getChild("URL");
        if (url) return { kind: "external", url: state.sliceDoc(url.from, url.to) };
      }
      if (node.name === "URL") return { kind: "external", url: state.sliceDoc(node.from, node.to) };
    }
  }
  return null;
}
