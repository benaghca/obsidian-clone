// "Merge entire file with...": the shared prompt listing the other notes.
// The chosen note gets this note's text appended, and this note is deleted
// (to the vault's .trash), like Obsidian's Note composer.

import { mergeNote } from "../fileOps";
import { noteName, parentDir } from "../paths";
import type { Workspace } from "../workspace";
import { fuzzyRank } from "./fuzzy";
import { hints, openPrompt, suggestionText } from "./prompt";

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
    instructions: hints("to merge"),
    items(query) {
      if (!query.trim()) {
        const recent = ws.recent.filter((p) => p !== path);
        const order = [...recent, ...notes.map((n) => n.path).filter((p) => !recent.includes(p))];
        return order.flatMap((p) => (notes.some((n) => n.path === p) ? [{ path: p, name: noteName(p), indices: [] }] : [])).slice(0, 50);
      }
      return fuzzyRank(query, notes, (n) => n.name)
        .slice(0, 50)
        .map(({ item, indices }) => ({ path: item.path, name: item.name, indices }));
    },
    render: (item, row) => suggestionText(row, item.name, item.indices, parentDir(item.path)),
    choose(item) {
      mergeNote(ws, path, item.path).catch((err) => console.warn(`Could not merge ${path}`, err));
    },
  });
}
