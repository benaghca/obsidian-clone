// "Link with tab..." from a tab's menu, as in Obsidian 1.14.4 (observed):
// the panes light up as the pointer passes over them, and a click on one
// links the tab with that pane's tab (Escape, or a click outside the panes,
// gives up). From then on a note opened in either opens in both, and both
// headers show a link icon that unlinks them.

import { behindLink, pushBack, type Tab } from "../tabs";
import type { Workspace } from "../workspace";

export function createTabLinks(ws: Workspace) {
  // The tab on screen opened a note: the tabs linked with it open it too.
  ws.on((change) => {
    if (change !== "show") return;
    const tab = ws.active;
    const behind = behindLink(tab, ws.layout.tabs());
    if (!behind.length) return;
    behind.forEach((tab) => pushBack(tab));
    ws.reopen(behind, tab.path!);
  });

  /** Pick the pane whose tab `tab` links with. */
  function start(tab: Tab) {
    let lit: Element | null = null;
    const light = (pane: Element | null) => {
      lit?.classList.remove("is-link-target");
      lit = pane;
      lit?.classList.add("is-link-target");
    };
    const paneAt = (e: Event) => (e.target as Element).closest?.(".workspace-tabs") ?? null;
    const move = (e: MouseEvent) => light(paneAt(e));
    // The pane's own pointerdown has made its group the active one by now.
    const pick = (e: MouseEvent) => {
      const pane = paneAt(e);
      stop();
      if (!pane) return;
      e.preventDefault();
      e.stopPropagation();
      if (ws.active !== tab) ws.setLink(tab, ws.active);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.preventDefault(), stop());
    function stop() {
      light(null);
      document.body.classList.remove("is-linking-tab");
      removeEventListener("mousemove", move, true);
      removeEventListener("mousedown", pick, true);
      removeEventListener("keydown", key, true);
    }
    document.body.classList.add("is-linking-tab");
    addEventListener("mousemove", move, true);
    addEventListener("mousedown", pick, true);
    addEventListener("keydown", key, true);
  }

  return { start };
}
