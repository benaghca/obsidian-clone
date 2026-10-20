// "Move file to...": the shared prompt listing the vault's folders.

import { parentDir, type Workspace } from "../workspace";
import { h } from "./dom";
import { fuzzyMatch, highlight } from "./fuzzy";
import { openPrompt } from "./prompt";

interface FolderItem {
  path: string;
  indices: number[];
}

export function openMovePrompt(ws: Workspace, path: string) {
  const here = parentDir(path);
  // A folder can't move into itself or anything inside it.
  const folders = ["", ...ws.files.filter((f) => f.is_dir).map((f) => f.path)].filter(
    (f) => f !== here && f !== path && !f.startsWith(path + "/"),
  );
  const label = (f: string) => f || "/";
  openPrompt<FolderItem>({
    placeholder: "Type a folder",
    emptyText: "No folders found.",
    instructions: [
      ["↑↓", "to navigate"],
      ["↵", "to move"],
      ["esc", "to dismiss"],
    ],
    items(query) {
      if (!query.trim()) return folders.map((f) => ({ path: f, indices: [] }));
      const scored = [];
      for (const f of folders) {
        const m = fuzzyMatch(query, label(f));
        if (m) scored.push({ path: f, indices: m.indices, score: m.score });
      }
      return scored.sort((a, b) => b.score - a.score);
    },
    render(item, row) {
      row.append(h("div", { class: "suggestion-content" }, h("div", { class: "suggestion-title" }, highlight(label(item.path), item.indices))));
    },
    choose(item) {
      ws.moveTo(path, item.path).catch((err) => console.warn(`Could not move ${path}`, err));
    },
  });
}
