// Right sidebar: Backlinks and Outline for the open note, switched with icon
// tabs at the top like Obsidian's. Only the selected view, and only while the
// sidebar is open, does any work.

import type { Workspace } from "../workspace";
import { createBacklinksView } from "./backlinksView";
import { h, iconButton } from "./dom";
import { icon, type IconName } from "./icons";
import { createOutlineView, type SideView } from "./outlineView";

export type RightView = "backlinks" | "outline";

export interface RightSidebar {
  el: HTMLElement;
  readonly view: RightView;
  select(view: RightView): void;
  /** Re-check which view should be working (after the sidebar opens or closes). */
  sync(): void;
  onSelect(fn: (view: RightView) => void): void;
}

export function createRightSidebar(ws: Workspace, isOpen: () => boolean): RightSidebar {
  const views: Record<RightView, SideView> = {
    backlinks: createBacklinksView(ws),
    outline: createOutlineView(ws),
  };
  const buttons = new Map<RightView, HTMLElement>();
  const listeners = new Set<(view: RightView) => void>();
  const content = h("div", { class: "workspace-leaf-content" });
  let current: RightView = "backlinks";

  const tab = (name: RightView, iconName: IconName, label: string) => {
    const button = iconButton(icon(iconName, 16), label, () => select(name), "workspace-tab-header");
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
  };
}
