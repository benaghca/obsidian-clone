// Tags view for the right sidebar: every #tag in the vault with how often
// it is used, nested tags ("#project/grove") as a tree, like Obsidian's tag
// pane. The backend has no tag index, so this asks its search for lines
// containing "#" and reads the tags from those lines. It runs only while the
// view is shown, after a vault change settles, never on a keystroke.

import { api } from "../api";
import type { Workspace } from "../workspace";
import { h } from "./dom";
import { icon } from "./icons";
import { type TagNode, tagsInLine, tagTree } from "./linksTags";
import type { SideView } from "./outlineView";

const LIMIT = 100_000;
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
  let shown = "";

  async function refresh() {
    const mine = ++seq;
    let hits: { path: string; line: number; text: string }[] = [];
    try {
      hits = await api.search("#", LIMIT);
    } catch (err) {
      console.error("Could not read tags", err);
    }
    if (mine !== seq || !active) return;
    stale = false;
    const tags: string[] = [];
    for (const hit of hits) if (hit.line > 0 && hit.path.endsWith(".md")) tags.push(...tagsInLine(hit.text));
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
      else if (!active) clearTimeout(timer);
    },
  };
}
