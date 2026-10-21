// "Move file to...": the shared prompt listing the vault's folders.

import { moveFile } from "../fileOps";
import { parentDir } from "../paths";
import type { Workspace } from "../workspace";
import { fuzzyRank } from "./fuzzy";
import { hints, openPrompt, suggestionText } from "./prompt";

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
    instructions: hints("to move"),
    items(query) {
      if (!query.trim()) return folders.map((f) => ({ path: f, indices: [] }));
      return fuzzyRank(query, folders, label).map(({ item, indices }) => ({ path: item, indices }));
    },
    render: (item, row) => suggestionText(row, label(item.path), item.indices),
    choose(item) {
      moveFile(ws, path, item.path).catch((err) => console.warn(`Could not move ${path}`, err));
    },
  });
}
