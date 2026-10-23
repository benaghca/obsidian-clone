// Ctrl+O quick switcher: the shared prompt with notes as items (fuzzy
// matches with bolded letters, recent notes first for an empty query).

import { parentDir } from "../paths";
import { whereFromEvent } from "../tabs";
import type { Workspace } from "../workspace";
import { h } from "./dom";
import { altKey, modKey } from "./keys";
import { openPrompt, suggestionText } from "./prompt";
import { type SwitcherItem, switcherItems } from "./switcherItems";

// Enter opens in the tab, Ctrl/Cmd+Enter in a new tab, Ctrl/Cmd+Alt+Enter
// to the right, as in Obsidian (a click works the same with the modifiers).
export function openQuickSwitcher(ws: Workspace) {
  openPrompt<SwitcherItem>({
    placeholder: "Find or create a note...",
    emptyText: "No notes found.",
    instructions: [
      ["↑↓", "to navigate"],
      ["tab", "to complete"],
      ["↵", "to open"],
      [`${modKey} ↵`, "to open in new tab"],
      [`${modKey} ${altKey} ↵`, "to open to the right"],
      ["shift ↵", "to create"],
      ["esc", "to dismiss"],
    ],
    items: (query) => switcherItems(query, ws.vault.includedNotes(), ws.recent, ws.active.path),
    render(item, row) {
      suggestionText(row, item.name, item.indices, item.path ? parentDir(item.path) : "");
      if (item.path === null) row.append(h("div", { class: "suggestion-aux" }, h("span", { class: "suggestion-action" }, "Enter to create")));
    },
    choose(item, e) {
      if (item.path) void ws.open(item.path, { where: whereFromEvent(e) });
      else void ws.openLink(item.name, whereFromEvent(e));
    },
    onKey(e, selected, query, close, setQuery) {
      if (e.key === "Tab" && !e.shiftKey) {
        if (selected) setQuery(selected.name, item => item.path === selected.path);
        return true;
      }
      if (e.key !== "Enter" || !e.shiftKey || !query.trim()) return false;
      close(false);
      void ws.openLink(query.trim(), whereFromEvent(e));
      return true;
    },
  });
}
