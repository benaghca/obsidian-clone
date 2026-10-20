// Ctrl+O quick switcher: the shared prompt with notes as items (fuzzy
// matches with bolded letters, recent notes first for an empty query).

import { parentDir, type Workspace } from "../workspace";
import { h } from "./dom";
import { highlight } from "./fuzzy";
import { modKey } from "./keys";
import { openPrompt } from "./prompt";
import { type SwitcherItem, switcherItems } from "./switcherItems";

export function openQuickSwitcher(ws: Workspace) {
  const newTab = (e: KeyboardEvent | MouseEvent) => e.ctrlKey || e.metaKey;
  openPrompt<SwitcherItem>({
    placeholder: "Find or create a note...",
    emptyText: "No notes found.",
    instructions: [
      ["↑↓", "to navigate"],
      ["↵", "to open"],
      [`${modKey} ↵`, "to open in new tab"],
      ["shift ↵", "to create"],
      ["esc", "to dismiss"],
    ],
    items: (query) => switcherItems(query, ws.notes, ws.recent, ws.active.path),
    render(item, row) {
      const content = h("div", { class: "suggestion-content" }, h("div", { class: "suggestion-title" }, highlight(item.name, item.indices)));
      row.append(content);
      if (item.path === null) row.append(h("div", { class: "suggestion-aux" }, h("span", { class: "suggestion-action" }, "Enter to create")));
      else if (parentDir(item.path)) content.append(h("div", { class: "suggestion-note" }, parentDir(item.path)));
    },
    choose(item, e) {
      if (item.path) void ws.open(item.path, { newTab: newTab(e) });
      else void ws.openLink(item.name, newTab(e));
    },
    onKey(e, _selected, query, close) {
      if (e.key !== "Enter" || !e.shiftKey || !query.trim()) return false;
      close(false);
      void ws.openLink(query.trim(), newTab(e));
      return true;
    },
  });
}
