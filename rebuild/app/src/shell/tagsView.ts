// Tags view for the right sidebar: every #tag in the vault with how often
// it is used, nested tags ("#project/grove") as a tree, like Obsidian's tag
// pane. The saved tags come from vaultTags.ts (the backend's search); the
// open note is read from the editor instead, so unsaved text counts. It runs
// only while the view is shown: the search after a vault change settles,
// the open note on a debounce after typing.

import type { Workspace } from "../workspace";
import { h } from "./dom";
import { icon } from "./icons";
import { type TagNode, tagsInText, tagTree } from "./linksTags";
import type { SideView } from "./outlineView";
import { createTagReader } from "./vaultTags";

const DELAY = 300;

export function createTagsView(ws: Workspace, searchFor: (query: string) => void): SideView {
  const list = h("div", { class: "tag-container" });
  const empty = h("div", { class: "pane-empty" }, "No tags found.");
  const el = h("div", { class: "backlink-pane tag-pane" }, list, empty);
  const collapsed = new Set<string>();

  let active = false;
  let stale = true;
  let timer = 0;
  let seq = 0;
  let docTimer = 0;
  let shown = "";
  /** Saved tags per note from the last search. */
  let saved = new Map<string, string[]>();
  const readTags = createTagReader(ws);

  async function refresh() {
    const mine = ++seq;
    try {
      const tags = await readTags();
      if (mine !== seq) return;
      saved = tags;
    } catch (err) {
      console.error("Could not read tags", err);
    }
    if (mine !== seq || !active) return;
    stale = false;
    render();
  }

  function render() {
    const open = ws.active.path;
    const tags: string[] = [];
    // Excluded files (Settings → Files and links) don't count.
    for (const [path, list] of saved) if (path !== open && !ws.isExcluded(path)) tags.push(...list);
    if (open?.endsWith(".md") && !ws.isExcluded(open)) tags.push(...tagsInText(ws.view.state.doc.toString()));
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
      const isCollapsed = collapsed.has(n.tag.toLowerCase());
      kids.hidden = isCollapsed;
      const chevron = n.children.length
        ? h(
            "div",
            {
              class: `tree-item-icon collapse-icon${isCollapsed ? " is-collapsed" : ""}`,
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                kids.hidden = !kids.hidden;
                chevron!.classList.toggle("is-collapsed", kids.hidden);
                if (kids.hidden) collapsed.add(n.tag.toLowerCase());
                else collapsed.delete(n.tag.toLowerCase());
              },
            },
            icon("chevron-down", 14),
          )
        : null;
      const self = h(
        "div",
        { class: "tree-item-self tag-pane-tag", title: `#${n.tag}`, onclick: () => searchFor(`#${n.tag}`) },
        chevron,
        h("div", { class: "tree-item-inner" }, h("span", { class: "tag-pane-tag-text" }, `#${depth ? n.name : n.tag}`)),
        h("div", { class: "tree-item-flair" }, n.count.toLocaleString()),
      );
      self.style.setProperty("--depth", String(depth));
      return h("div", { class: "tree-item" }, self, n.children.length ? kids : null);
    });
  }

  function schedule() {
    clearTimeout(timer);
    if (active) timer = window.setTimeout(() => void refresh(), DELAY);
  }

  ws.on((change) => {
    if (change === "doc" || change === "show") {
      // The open note's own tags: no backend call, and nothing on the keystroke itself.
      clearTimeout(docTimer);
      if (active && !stale) docTimer = window.setTimeout(render, change === "doc" ? DELAY : 0);
      return;
    }
    if (change !== "links" && change !== "files") return;
    stale = true;
    schedule();
  });

  return {
    el,
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active && stale) schedule();
      else if (active) render();
      else {
        clearTimeout(timer);
        clearTimeout(docTimer);
      }
    },
  };
}
