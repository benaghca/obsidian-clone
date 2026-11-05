// Write pasted or dropped files into the vault. The note embed and the canvas
// card are the callers' job; both share this so the name, the folder and the
// 20 MB cap stay one path.

import { api } from "../api";
import { settings } from "../settings/store";
import type { Workspace } from "../workspace";
import { attachmentPaths } from "./attachments";

const ATTACHMENT_MAX = 20 * 1024 * 1024;

/**
 * Save `files` under the attachment folder and return the paths that landed.
 * `pasted` stamps a nameless clipboard image; a drop keeps the file's name.
 * One refresh after the writes. A file over 20 MB is skipped.
 */
export async function writeAttachments(ws: Workspace, from: string | null, files: File[], pasted = true): Promise<string[]> {
  if (!files.length) return [];
  const incoming: { name: string; type: string; bytes: Uint8Array }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > ATTACHMENT_MAX) {
      console.warn("Grove skipped an attachment over 20 MB", file.name);
      continue;
    }
    incoming.push({ name: file.name, type: file.type, bytes });
  }
  if (!incoming.length) return [];
  const paths = attachmentPaths(from, settings.get("app.json").attachmentFolderPath, incoming, ws.vault.files.map((f) => f.path), new Date(), pasted);
  const saved: string[] = [];
  for (let i = 0; i < incoming.length; i++) {
    try {
      await api.writeFileBytes(paths[i], incoming[i].bytes);
      saved.push(paths[i]);
    } catch (err) {
      console.warn("Grove could not save an attachment", paths[i], err);
    }
  }
  if (saved.length) await ws.vault.refreshFiles();
  return saved;
}
