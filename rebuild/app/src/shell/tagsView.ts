// Tags view for the right sidebar: every #tag in the vault with how often
// it is used, nested tags ("#project/grove") as a tree, like Obsidian's tag
// pane. The saved tags come from vaultTags.ts (the backend's search); the
// open note is read from the editor instead, so unsaved text counts. It runs
// only while the view is shown: the search after a vault change settles,
// the open note on a debounce after typing.

import type { Workspace } from "../workspace";
import { h } from "./dom";
import { type TagNode, tagsInText, tagTree } from "./linksTags";
import { foldIn, foldToggle, liveData, type SideView } from "./sideView";
import { vaultTags } from "./vaultTags";

const DELAY = 300;

export function createTagsView(ws: Workspace, searchFor: (query: string) => void): SideView {
  const list = h("div", { class: "tag-container" });
  const empty = h("div", { class: "pane-empty" }, "No tags found.");
  const el = h("div", { class: "backlink-pane tag-pane" }, list, empty);
  const collapsed = new Set<string>();

  let docTimer = 0;
  let shown = "";
  /** Saved tags per note. */
  const saved = liveData(new Map<string, string[]>(), () => vaultTags(ws).read(), render, "tags");

  function render() {
    const open = ws.active.path;
    const tags: string[] = [];
    // Excluded files (Settings → Files and links) don't count.
    for (const [path, list] of saved.data) if (path !== open && !ws.vault.isExcluded(path)) tags.push(...list);
    if (open?.endsWith(".md") && !ws.vault.isExcluded(open)) tags.push(...tagsInText(ws.view.state.doc.toString()));
    const tree = tagTree(tags);
    const key = JSON.stringify(tree);
    if (key === shown) return;
    shown = key;
    list.replaceChildren(...rows(tree, 0));
    empty.hidden = tree.length > 0;
  }

  function rows(nodes: TagNode[], depth: number): HTMLElement[] {
    return nodes.map((n) => {
      const kids = h("div", { class: "tree-item-children" }, ...rows(n.children, depth + 1));
      const key = n.tag.toLowerCase();
      const chevron = n.children.length ? foldToggle(kids, collapsed.has(key), foldIn(collapsed, key)) : null;
      const self = h(
        "div",
        { class: "tree-item-self tag-pane-tag", title: `#${n.tag}`, onclick: () => searchFor(`tag:#${n.tag}`) },
        chevron,
        h("div", { class: "tree-item-inner" }, h("span", { class: "tag-pane-tag-text" }, `#${depth ? n.name : n.tag}`)),
        h("div", { class: "tree-item-flair" }, n.count.toLocaleString()),
      );
      self.style.setProperty("--depth", String(depth));
      return h("div", { class: "tree-item" }, self, n.children.length ? kids : null);
    });
  }

  ws.on((change) => {
    if (change === "doc" || change === "show") {
      // The open note's own tags: no backend call, and nothing on the keystroke itself.
      clearTimeout(docTimer);
      if (saved.active && !saved.stale) docTimer = window.setTimeout(render, change === "doc" ? DELAY : 0);
    } else if (change === "links" || change === "files") saved.changed(DELAY);
  });

  return {
    el,
    setActive(next) {
      if (!saved.setActive(next, DELAY)) return;
      if (!next) clearTimeout(docTimer);
      else if (!saved.stale) render();
    },
  };
}
