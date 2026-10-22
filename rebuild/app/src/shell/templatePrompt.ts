// Templates: Insert template: the shared prompt listing the notes in the
// template folder (Settings → Templates), fuzzy-filtered.

import { noteName } from "../paths";
import type { NoteRef } from "../editor/host";
import { pickFrom } from "./prompt";

export function openTemplatePrompt(notes: NoteRef[], choose: (path: string) => void) {
  const names = notes.map((n) => ({ path: n.path, name: noteName(n.path) })).sort((a, b) => (a.name < b.name ? -1 : 1));
  pickFrom(names, (n) => n.name, {
    placeholder: "Type to search templates...",
    emptyText: "No templates found. Put notes in the template folder (Settings → Templates).",
    restoreFocusOnChoose: true,
    enter: "to insert",
    choose: (n) => choose(n.path),
  });
}
