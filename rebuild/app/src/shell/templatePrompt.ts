// Templates: Insert template: the shared prompt listing the notes in the
// template folder (Settings → Templates), fuzzy-filtered.

import { noteName } from "../workspace";
import type { NoteRef } from "../editor/host";
import { h } from "./dom";
import { fuzzyMatch, highlight } from "./fuzzy";
import { openPrompt } from "./prompt";

interface Item {
  path: string;
  name: string;
  indices: number[];
}

export function openTemplatePrompt(notes: NoteRef[], choose: (path: string) => void) {
  openPrompt<Item>({
    placeholder: "Type to search templates...",
    emptyText: "No templates found. Put notes in the template folder (Settings → Templates).",
    restoreFocusOnChoose: true,
    instructions: [
      ["↑↓", "to navigate"],
      ["↵", "to insert"],
      ["esc", "to dismiss"],
    ],
    items(query) {
      const all = notes.map((n) => ({ path: n.path, name: noteName(n.path), indices: [] as number[] }));
      if (!query.trim()) return all.sort((a, b) => (a.name < b.name ? -1 : 1));
      const scored = [];
      for (const n of all) {
        const m = fuzzyMatch(query, n.name);
        if (m) scored.push({ ...n, indices: m.indices, score: m.score });
      }
      return scored.sort((a, b) => b.score - a.score);
    },
    render(item, row) {
      row.append(h("div", { class: "suggestion-content" }, h("div", { class: "suggestion-title" }, highlight(item.name, item.indices))));
    },
    choose: (item) => choose(item.path),
  });
}
