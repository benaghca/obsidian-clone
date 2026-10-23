// "Merge entire file with...": the shared prompt listing the other notes.
// The chosen note gets this note's text appended, and this note is deleted
// (to the vault's .trash), like Obsidian's Note composer.

import { mergeNote } from "../fileOps";
import { noteName, parentDir } from "../paths";
import type { Workspace } from "../workspace";
import { hints, openPrompt, suggestionText } from "./prompt";
import { type SwitcherItem, switcherItems } from "./switcherItems";

type NoteItem = SwitcherItem & { path: string };

export function openMergePrompt(ws: Workspace, path: string) {
  const notes = ws.vault.notes.filter((n) => n.path !== path);
  openPrompt<NoteItem>({
    placeholder: `Merge "${noteName(path)}" into...`,
    emptyText: "No notes found.",
    instructions: hints("to merge"),
    // Merge still offers every note, with recents first, even for an empty query.
    items: (query) => switcherItems(query, notes, [...ws.recent, ...notes.map(n => n.path)], path).filter((item): item is NoteItem => item.path !== null),
    render: (item, row) => suggestionText(row, item.name, item.indices, parentDir(item.path)),
    choose(item) {
      mergeNote(ws, path, item.path).catch((err) => console.warn(`Could not merge ${path}`, err));
    },
  });
}
