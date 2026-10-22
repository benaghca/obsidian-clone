// "Move file to...": the shared prompt listing the vault's folders.

import { moveFile } from "../fileOps";
import { parentDir } from "../paths";
import type { Workspace } from "../workspace";
import { pickFrom } from "./prompt";

export function openMovePrompt(ws: Workspace, path: string) {
  const here = parentDir(path);
  // A folder can't move into itself or anything inside it.
  const folders = ["", ...ws.vault.files.filter((f) => f.is_dir).map((f) => f.path)].filter(
    (f) => f !== here && f !== path && !f.startsWith(path + "/"),
  );
  pickFrom(folders, (f) => f || "/", {
    placeholder: "Type a folder",
    emptyText: "No folders found.",
    enter: "to move",
    choose: (folder) => void moveFile(ws, path, folder).catch((err) => console.warn(`Could not move ${path}`, err)),
  });
}
