// Right sidebar: Backlinks, Outgoing links, Tags and Outline, switched with
// icon tabs at the top like Obsidian's. Only the selected view, and only
// while the sidebar is open, does any work.

import type { Workspace } from "../workspace";
import { createBacklinksView } from "./backlinksView";
import { h, iconButton } from "./dom";
import { icon, type IconName } from "./icons";
import { createOutgoingView } from "./outgoingView";
import { createOutlineView, type SideView } from "./outlineView";
import { createTagsView } from "./tagsView";

export const RIGHT_VIEWS = ["backlinks", "outgoing", "tags", "outline"] as const;
export type RightView = (typeof RIGHT_VIEWS)[number];

export interface RightSidebar {
  el: HTMLElement;
  readonly view: RightView;
  select(view: RightView): void;
  /** Re-check which view should be working (after the sidebar opens or closes). */
  sync(): void;
  onSelect(fn: (view: RightView) => void): void;
  /** Show or remove a view (its core plugin turned on or off). Returns whether any view is left. */
  setEnabled(view: RightView, enabled: boolean): boolean;
}

/** `searchFor` runs a vault search in the left sidebar (a click on a tag). */
export function createRightSidebar(ws: Workspace, isOpen: () => boolean, searchFor: (query: string) => void): RightSidebar {
  const views: Record<RightView, SideView> = {
    backlinks: createBacklinksView(ws),
    outgoing: createOutgoingView(ws),
    tags: createTagsView(ws, searchFor),
    outline: createOutlineView(ws),
  };
  const buttons = new Map<RightView, HTMLElement>();
  const listeners = new Set<(view: RightView) => void>();
  const content = h("div", { class: "workspace-leaf-content" });
  let current: RightView = "backlinks";

  const tab = (name: RightView, iconName: IconName, label: string) => {
    const button = iconButton(icon(iconName), label, () => select(name), "workspace-tab-header");
    buttons.set(name, button);
    return button;
  };

  function show(name: RightView) {
    current = name;
    for (const [n, b] of buttons) b.classList.toggle("is-active", n === name);
    if (content.firstElementChild !== views[name].el) content.replaceChildren(views[name].el);
  }

  function select(name: RightView) {
    const changed = name !== current;
    show(name);
    sync();
    if (changed) for (const fn of listeners) fn(name);
  }

  function sync() {
    const open = isOpen();
    for (const [name, view] of Object.entries(views) as [RightView, SideView][]) view.setActive(open && name === current);
  }

  const el = h(
    "div",
    { class: "workspace-split mod-sidedock mod-right-split" },
    h(
      "div",
      { class: "workspace-tab-header-container", "data-tauri-drag-region": "" },
      tab("backlinks", "link", "Backlinks"),
      tab("outgoing", "link-2", "Outgoing links"),
      tab("tags", "tags", "Tags"),
      tab("outline", "list", "Outline"),
    ),
    content,
  );
  show(current); // views start inactive; sync() wakes the selected one once the dock opens

  return {
    el,
    get view() {
      return current;
    },
    select,
    sync,
    onSelect: (fn) => void listeners.add(fn),
    setEnabled(view, enabled) {
      buttons.get(view)!.hidden = !enabled;
      const available = RIGHT_VIEWS.filter((v) => !buttons.get(v)!.hidden);
      if (!enabled && current === view && available.length) select(available[0]);
      if (!enabled && current === view) views[view].setActive(false);
      return available.length > 0;
    },
  };
}
