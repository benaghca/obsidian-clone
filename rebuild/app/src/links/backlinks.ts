// Share targeted reads between the status bar and visible backlink panes.
// A new file/link snapshot invalidates them; older replies stay with their
// own promises and cannot repopulate the current cache.
import { api, type Backlink } from "../api";
import { kept, perWorkspace } from "../memo";
import type { Workspace } from "../workspace";

export const noteBacklinks = perWorkspace((ws: Workspace) => {
  const cache = new Map<string, Promise<Backlink[]>>();
  let files = ws.vault.files, links = ws.vault.links;
  return (path: string): Promise<Backlink[]> => {
    if (files !== ws.vault.files || links !== ws.vault.links) {
      cache.clear();
      files = ws.vault.files;
      links = ws.vault.links;
    }
    return kept(cache, path, () => {
      const pending = api.backlinks([path]).then((found) => found[path] ?? []).catch((err) => {
        if (cache.get(path) === pending) cache.delete(path);
        throw err;
      });
      return pending;
    });
  };
});
