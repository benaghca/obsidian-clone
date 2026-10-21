// "Merge entire file with...": the shared prompt listing the other notes.
// The chosen note gets this note's text appended, and this note is deleted
// (to the vault's .trash), like Obsidian's Note composer.

import { mergeNote } from "../fileOps";
import { noteName, parentDir } from "../paths";
import type { Workspace } from "../workspace";
import { h } from "./dom";
import { fuzzyMatch, highlight } from "./fuzzy";
import { openPrompt } from "./prompt";

interface NoteItem {
  path: string;
  name: string;
  indices: number[];
}

export function openMergePrompt(ws: Workspace, path: string) {
  const notes = ws.notes.filter((n) => n.path !== path);
  openPrompt<NoteItem>({
    placeholder: `Merge "${noteName(path)}" into...`,
    emptyText: "No notes found.",
    instructions: [
      ["↑↓", "to navigate"],
      ["↵", "to merge"],
      ["esc", "to dismiss"],
    ],
    items(query) {
      if (!query.trim()) {
        const recent = ws.recent.filter((p) => p !== path);
        const order = [...recent, ...notes.map((n) => n.path).filter((p) => !recent.includes(p))];
        return order.flatMap((p) => (notes.some((n) => n.path === p) ? [{ path: p, name: noteName(p), indices: [] }] : [])).slice(0, 50);
      }
      const scored = [];
      for (const n of notes) {
        const m = fuzzyMatch(query, n.name);
        if (m) scored.push({ path: n.path, name: n.name, indices: m.indices, score: m.score });
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, 50);
    },
    render(item, row) {
      const content = h("div", { class: "suggestion-content" }, h("div", { class: "suggestion-title" }, highlight(item.name, item.indices)));
      if (parentDir(item.path)) content.append(h("div", { class: "suggestion-note" }, parentDir(item.path)));
      row.append(content);
    },
    choose(item) {
      mergeNote(ws, path, item.path).catch((err) => console.warn(`Could not merge ${path}`, err));
    },
  });
}
