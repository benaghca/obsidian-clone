// A tab group's tab strip, as in Obsidian: a header per tab (its title, a
// close button or, on a pinned tab, a pin; an icon on graph tabs), "New
// tab", the tab list chevron and the right sidebar toggle (shown only in the
// top-right pane). Headers are kept per tab id and updated in place, so a
// switch only flips classes, and opening or closing a tab animates its own
// header. A click activates its tab; dragging keeps the current note
// on screen (tabDrag.ts). A middle click closes it.

import { commands } from "../commands";
import { duration, easing } from "../motion";
import { type Group, linkedWith, type Tab, tabTitle, viewIcon } from "../tabs";
import type { Workspace } from "../workspace";
import { h, iconButton } from "./dom";
import { icon } from "./icons";
import { showMenu } from "./menu";
import type { Menus } from "./menus";
import type { GroupView } from "./pane";
import { startTabDrag } from "./tabDrag";

export type TabStrip = ReturnType<typeof createTabStrip>;

export function createTabStrip(ws: Workspace, group: Group, menus: () => Menus, views: () => GroupView[]) {
  /** The row of tab headers. */
  const tabList = h("div", { class: "workspace-tab-header-container-inner" });
  const tabListButton = iconButton(icon("chevron-down"), "Show tab list", () =>
    showMenu(menus().tabList(group), tabListButton, { align: "right" }),
  );
  const el = h(
    "div",
    { class: "workspace-tab-header-container" },
    tabList,
    iconButton(icon("plus"), "New tab", () => ws.newTab(group), "workspace-tab-header-new-tab"),
    h("div", { class: "workspace-tab-header-spacer" }),
    h("div", { class: "workspace-tab-header-tab-list" }, tabListButton),
    iconButton(icon("panel-right"), "Toggle right sidebar", () => commands.run("app:toggle-right-sidebar"), "sidebar-toggle-button mod-right"),
  );
  /** Each tab's header by tab id (the drag code measures them). */
  const headers = new Map<number, { el: HTMLElement; title: HTMLElement; close: HTMLElement }>();
  let rendered = false;

  function tabHeader(tab: Tab) {
    const title = h("div", { class: "workspace-tab-header-inner-title" });
    // Linked with another tab ("Link with tab..."): a click unlinks it.
    const linked = h(
      "div",
      { class: "workspace-tab-header-status-icon mod-linked", "aria-label": "Unlink tab", onpointerdown: (e: PointerEvent) => e.stopPropagation(), onclick: () => ws.setLink(tab, null) },
      icon("link", 14),
    );
    // Close button; on a pinned tab, a pin that unpins it (as in Obsidian).
    const close = h("div", {
      class: "workspace-tab-header-inner-close-button",
      onpointerdown: (e: PointerEvent) => e.stopPropagation(),
      onmousedown: (e: MouseEvent) => e.stopPropagation(),
      onclick: () => (tab.pinned ? ws.togglePin(tab) : ws.closeTab(tab)),
    });
    const el = h(
      "div",
      {
        class: "workspace-tab-header",
        onpointerdown: (e: PointerEvent) => {
          if (e.button === 1) {
            e.preventDefault();
            ws.closeTab(tab);
          } else if (e.button === 0) {
            startTabDrag(e, tab, ws, views);
          }
        },
        // Middle-click must not paste or autoscroll.
        onmousedown: (e: MouseEvent) => {
          if (e.button === 1) e.preventDefault();
        },
        oncontextmenu: (e: MouseEvent) => {
          e.preventDefault();
          showMenu(menus().tab(tab), { x: e.clientX, y: e.clientY });
        },
      },
      h("div", { class: "workspace-tab-header-inner" }, title, linked, close),
    );
    return { el, title, close };
  }

  function render() {
    const open = new Set(group.tabs.map((tab) => tab.id));
    for (const [id, { el }] of headers) {
      if (open.has(id)) continue;
      headers.delete(id);
      closeTabHeader(el);
    }
    let prev: Element | null = null;
    const added: HTMLElement[] = [];
    for (const tab of group.tabs) {
      let header = headers.get(tab.id);
      if (!header) {
        headers.set(tab.id, (header = tabHeader(tab)));
        if (rendered) added.push(header.el);
      }
      const { el, title, close } = header;
      const name = tabTitle(tab);
      if (title.textContent !== name) title.textContent = name;
      el.setAttribute("aria-label", tab.path ?? name);
      const shownIcon = viewIcon(tab);
      if ((el.dataset.icon ?? null) !== shownIcon) {
        el.querySelector(".workspace-tab-header-inner-icon")?.remove();
        if (shownIcon) el.firstElementChild!.prepend(h("div", { class: "workspace-tab-header-inner-icon" }, icon(shownIcon, 16)));
        if (shownIcon) el.dataset.icon = shownIcon;
        else delete el.dataset.icon;
      }
      el.classList.toggle("is-active", tab === group.active);
      el.classList.toggle("is-linked", linkedWith(tab, ws.layout.tabs()).length > 0);
      if (el.classList.contains("is-pinned") !== tab.pinned || !close.firstChild) {
        el.classList.toggle("is-pinned", tab.pinned);
        close.replaceChildren(icon(tab.pinned ? "pin" : "x", 14));
        close.setAttribute("aria-label", tab.pinned ? "Unpin" : "Close");
      }
      // Headers still shrinking away keep their place; order around them.
      let at: Element | null = prev ? prev.nextElementSibling : tabList.firstElementChild;
      while (at && at !== el && at.classList.contains("is-closing")) at = at.nextElementSibling;
      if (at !== el) tabList.insertBefore(el, at);
      prev = el;
    }
    for (const el of added) openTabHeader(el);
    rendered = true;
  }

  return { el, tabList, headers, render };
}

// A new tab grows from nothing to the width it has in the settled strip,
// which is measured first, so the last frame lands exactly on the layout
// and the neighbours give up their room smoothly as it grows. Only this
// tab's max-width animates; the strip is a small fixed-height box. A
// closed tab shrinks from its width to nothing, then goes; like a closing
// folder it eases in and out (a plain ease-in would leave the last third
// of the width to vanish in a single frame).
function slideTabHeader(el: HTMLElement, open: boolean, ms: number) {
  const width = el.getBoundingClientRect().width;
  const frames = [
    { maxWidth: "0px", minWidth: "0px", opacity: 0 },
    { maxWidth: `${width}px`, minWidth: "0px", opacity: 1 },
  ];
  el.style.overflow = "hidden";
  return el.animate(open ? frames : frames.reverse(), { duration: ms, easing: easing(open ? "out" : "in-out"), fill: open ? "auto" : "forwards" })
    .finished;
}

function openTabHeader(el: HTMLElement) {
  const ms = duration("moderate");
  if (ms > 0) slideTabHeader(el, true, ms).then(() => (el.style.overflow = ""), () => {});
}

// A tab that moved to another group just goes.
function closeTabHeader(el: HTMLElement) {
  el.classList.add("is-closing");
  const ms = duration("moderate");
  if (ms <= 0 || !el.isConnected || el.classList.contains("is-moving")) return el.remove();
  const remove = () => el.remove();
  slideTabHeader(el, false, ms).then(remove, remove);
}
