// "Export as SVG" and "Export as PNG" write "Sketch.svg" or "Sketch.png"
// next to "Sketch.excalidraw"; "Copy as PNG" puts the PNG on the system
// clipboard. Each pictures the drawing as saved (see picture.ts), after any
// edit waiting in its tab is written.

import { api } from "../api";
import { sourceVault } from "../vaultRoot";
import { queuedBytes, submitBytes, writeVaultNote } from "../vaultWrite";
import { confirmDialog } from "../shell/confirm";
import { notice } from "../shell/notice";
import { fileName } from "../paths";
import type { Workspace } from "../workspace";
import { saveDrawings } from "./pending";
import { drawingPng, drawingSvg, picturePath, type PictureKind } from "./picture";
import { parseScene, type Scene } from "./scene";

/** The drawing at `path` as saved, after any edit waiting in its tab is written. */
async function savedScene(path: string): Promise<Scene> {
  await saveDrawings((p) => p === path);
  const parsed = parseScene(await api.readNote(path));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.scene;
}

/**
 * Write the drawing at `path` as an SVG or PNG beside it. A file already
 * there is replaced only if the user says so. Returns the new file's path,
 * or null when they didn't.
 */
export async function exportDrawing(ws: Workspace, path: string, kind: PictureKind): Promise<string | null> {
  const to = picturePath(path, kind);
  const name = fileName(to);
  try {
    const scene = await savedScene(path);
    const taken = ws.vault.matchPath(to);
    if (taken?.is_dir) throw new Error(`“${name}” is a folder`);
    if (taken) {
      const answer = await confirmDialog({ title: `Replace “${name}”?`, message: "A file with that name is already there.", confirm: "Replace", warning: true });
      if (!answer.ok) return null;
    }
    const target = taken?.path ?? to;
    const source = sourceVault();
    if (kind === "svg") {
      if ((await writeVaultNote(target, drawingSvg(scene), () => ws.vault.written(target), undefined, source)) === "queued") return target;
    } else {
      const bytes = await drawingPng(scene);
      const pending = submitBytes(source, target, bytes, "replace");
      // Queued bytes belong to the vault that accepted them. Do not wait out a switch, and do not refresh the new root.
      if (queuedBytes(source, target) !== undefined) return target;
      await pending;
      ws.vault.written(target);
      if (sourceVault() !== source) return target;
    }
    await ws.vault.refreshFiles();
    ws.vault.written(target);
    notice([`Saved “${fileName(target)}”`]);
    return target;
  } catch (err) {
    notice([`Couldn’t export “${fileName(path)}”: ${err instanceof Error ? err.message : String(err)}`]);
    return null;
  }
}

/** Put the drawing at `path` on the clipboard as a PNG. Returns whether it worked. */
export async function copyDrawingPng(path: string): Promise<boolean> {
  try {
    await api.writeClipboardImage(await drawingPng(await savedScene(path)));
    notice(["Copied as PNG"]);
    return true;
  } catch (err) {
    notice([`Couldn’t copy “${fileName(path)}”: ${err instanceof Error ? err.message : String(err)}`]);
    return false;
  }
}
