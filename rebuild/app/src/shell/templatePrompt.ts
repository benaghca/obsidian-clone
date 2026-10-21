// Templates: Insert template: the shared prompt listing the notes in the
// template folder (Settings → Templates), fuzzy-filtered.

import { noteName } from "../paths";
import type { NoteRef } from "../editor/host";
import { fuzzyRank } from "./fuzzy";
import { hints, openPrompt, suggestionText } from "./prompt";

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
    instructions: hints("to insert"),
    items(query) {
      const all = notes.map((n) => ({ path: n.path, name: noteName(n.path), indices: [] as number[] }));
      if (!query.trim()) return all.sort((a, b) => (a.name < b.name ? -1 : 1));
      return fuzzyRank(query, all, (n) => n.name).map(({ item, indices }) => ({ ...item, indices }));
    },
    render: (item, row) => suggestionText(row, item.name, item.indices),
    choose: (item) => choose(item.path),
  });
}
