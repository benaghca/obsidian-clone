import { newCanvas, renameFile } from "../fileOps";
import { editInPlace } from "../shell/dom";
import type { Workspace } from "../workspace";
/** Reuse attachment creation and the shared selected inline rename control. */
export async function newBase(ws: Workspace, folder?: string) {
  const path = await newCanvas(ws, folder, "base");
  if (ws.active.type === "base" && ws.active.viewFile === path) {
    const title = document.querySelector<HTMLElement>(".workspace-tabs.mod-active .view-header-title");
    if (title) editInPlace(title, name => renameFile(ws, path, name));
  }
  return path;
}
