// "Move file to...": the shared prompt listing the vault's folders.

import { moveFile } from "../fileOps";
import { parentDir } from "../paths";
import type { Workspace } from "../workspace";
import { pickFrom } from "./prompt";
import { topLevelPaths } from "./treeSelect";

export function openMovePrompt(ws: Workspace, path: string | readonly string[]) {
  const paths = typeof path === "string" ? [path] : topLevelPaths(path, (item) => ws.vault.isFolder(item));
  if (!paths.length) return;
  // A folder can't move into itself or anything inside it. One file keeps the
  // original list: its own parent is left out, because that move would do nothing.
  const folders = ["", ...ws.vault.files.filter((f) => f.is_dir).map((f) => f.path)].filter((folder) =>
    paths.length === 1
      ? folder !== parentDir(paths[0]!) && folder !== paths[0] && !folder.startsWith(paths[0] + "/")
      : paths.some((item) => parentDir(item) !== folder) && paths.every((item) => !ws.vault.isFolder(item) || (folder !== item && !folder.startsWith(item + "/"))),
  );
  pickFrom(folders, (folder) => folder || "/", {
    placeholder: "Type a folder",
    emptyText: "No folders found.",
    enter: "to move",
    choose: (folder) => {
      void (async () => {
        for (const item of paths) {
          try {
            await moveFile(ws, item, folder);
          } catch (err) {
            console.warn(`Could not move ${item}`, err);
          }
        }
      })();
    },
  });
}
